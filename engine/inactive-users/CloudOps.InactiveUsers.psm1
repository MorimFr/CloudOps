Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot '../shared/CloudOps.Graph.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../shared/CloudOps.Execution.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../shared/CloudOps.Security.psm1') -DisableNameChecking
. (Join-Path $PSScriptRoot 'Report.ps1')

function Get-InactiveField {
    param([AllowNull()] [object] $Object, [string] $Name)
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) {
        return $Object.PSObject.Properties[$Name].Value
    }
    return $null
}

function ConvertTo-InactiveDate {
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime() }
    if ($Value -is [DateTime]) { return [DateTimeOffset]::new($Value.ToUniversalTime()) }
    $parsed = [DateTimeOffset]::MinValue
    if ($Value -isnot [string] -or [string] $Value -notmatch '^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$' -or
        -not [DateTimeOffset]::TryParse([string] $Value, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref] $parsed)) {
        throw [System.ArgumentException]::new('Invalid activity timestamp.')
    }
    return $parsed.ToUniversalTime()
}

function Get-InactiveDateField {
    param([AllowNull()] [object] $Object, [string] $Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    # Bind the raw property, not pipeline-unrolled arrays masquerading as null
    # or a single timestamp. Only JSON null or an actual timestamp is valid.
    return ConvertTo-InactiveDate -Value $property.Value
}

function Get-CloudOpsInactiveUserClassification {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $User,
        [Parameter(Mandatory)] [DateTimeOffset] $AsOfUtc,
        [DateTimeOffset] $ObservedAtUtc = $AsOfUtc,
        # Only the fixed, selected Graph inventory may enable absence-based rules.
        # Any failed page discards the entire artifact; never use an unselected
        # user object or an error response as evidence of missing history.
        [switch] $ActivitySelected
    )
    if ($ObservedAtUtc -lt $AsOfUtc) { throw [System.ArgumentException]::new('Observation precedes reference.') }
    $cutoff = $AsOfUtc.AddDays(-90)
    $result = [ordered]@{
        State = 'indeterminate'; Reason = 'invalid-activity-schema'; Evidence = 'insufficient'
        Days = $null; Created = $null; LastSuccess = $null; LatestAttempt = $null
        ActivityShape = 'omitted'; Warnings = [System.Collections.Generic.List[string]]::new()
    }
    $creationIssue = 'missing-creation'
    try {
        $result.Created = Get-InactiveDateField $User 'createdDateTime'
        if ($null -ne $result.Created) {
            $creationIssue = if ($result.Created -gt $ObservedAtUtc) { 'future-creation' } else { $null }
        }
    }
    catch { $creationIssue = 'invalid-creation' }
    if ($null -ne $creationIssue) { $result.Warnings.Add($creationIssue) }

    $activityProperty = $User.PSObject.Properties['signInActivity']
    $activity = $null
    if ($null -ne $activityProperty) { $activity = $activityProperty.Value }
    $hasSuccessField = $false
    $attemptFieldsComplete = $false
    $attemptIssue = $null
    if ($null -ne $activityProperty) {
        $result.ActivityShape = if ($null -eq $activity) { 'null' } elseif ($activity -is [pscustomobject]) { 'object' } else { 'invalid' }
    }
    if ($null -ne $activity) {
        if ($activity -isnot [pscustomobject]) { return [pscustomobject] $result }
        $hasSuccessField = $null -ne $activity.PSObject.Properties['lastSuccessfulSignInDateTime']
        $attemptFieldsComplete = $null -ne $activity.PSObject.Properties['lastSignInDateTime'] -and
            $null -ne $activity.PSObject.Properties['lastNonInteractiveSignInDateTime']
        if (-not $hasSuccessField -and -not $attemptFieldsComplete) { return [pscustomobject] $result }
        try { $result.LastSuccess = Get-InactiveDateField $activity 'lastSuccessfulSignInDateTime' }
        catch { $result.Reason = 'invalid-success'; return [pscustomobject] $result }
        foreach ($field in @('lastSignInDateTime', 'lastNonInteractiveSignInDateTime')) {
            try {
                $attempt = Get-InactiveDateField $activity $field
                if ($null -ne $attempt) {
                    if ($attempt -gt $ObservedAtUtc) { $attemptIssue = 'future-attempt' }
                    elseif ($null -ne $result.Created -and $attempt -lt $result.Created) { $attemptIssue = 'attempt-before-creation' }
                    if ($null -eq $result.LatestAttempt -or $attempt -gt $result.LatestAttempt) { $result.LatestAttempt = $attempt }
                }
            }
            catch { $attemptIssue = 'invalid-attempt' }
        }
        if ($null -ne $attemptIssue) { $result.Warnings.Add($attemptIssue) }
    }

    if ($null -ne $result.LastSuccess) {
        if ($result.LastSuccess -gt $ObservedAtUtc) { $result.Reason = 'future-success'; return [pscustomobject] $result }
        if ($null -ne $result.Created -and $result.LastSuccess -lt $result.Created) {
            $result.Reason = 'success-before-creation'; return [pscustomobject] $result
        }
        # A malformed/missing creation date does not invalidate a usable success.
        # Successes during the scan are active, not negative-day/future errors.
        $result.Days = [long] [Math]::Max(0, [Math]::Floor(($AsOfUtc - $result.LastSuccess).TotalDays))
        $result.State = if ($result.LastSuccess -le $cutoff) { 'inactive' } else { 'active' }
        $result.Reason = 'successful-sign-in'
        $result.Evidence = 'recorded-success'
        if ($result.LastSuccess -gt $AsOfUtc) { $result.Warnings.Add('success-during-collection') }
        return [pscustomobject] $result
    }

    if (-not $ActivitySelected) { $result.Reason = 'activity-not-selected'; return [pscustomobject] $result }
    if ($null -ne $creationIssue) { $result.Reason = $creationIssue; return [pscustomobject] $result }
    if ($null -ne $attemptIssue) { $result.Reason = $attemptIssue; return [pscustomobject] $result }
    if ($null -ne $activity -and -not $hasSuccessField) {
        # Both attempt fields must be present and only old attempts may support
        # this fallback. Recent attempts do not reveal success vs. failure.
        if ($null -eq $result.LatestAttempt -or $result.LatestAttempt -gt $cutoff) {
            $result.Reason = 'missing-success-without-old-attempts'; return [pscustomobject] $result
        }
        $result.Reason = 'old-attempts-only'
        $result.Evidence = 'historical-attempts'
    }
    else {
        # Microsoft documents omitted signInActivity for never/very old sign-ins.
        # Null and omitted are operational absence, never proof of "never used".
        $result.Reason = if ($null -eq $activity) { 'no-activity-history' } else { 'no-recorded-success' }
        $result.Evidence = 'absence-and-creation'
    }
    $result.State = if ($result.Created -le $cutoff) { 'inactive' } else { 'initial' }
    if ($null -ne $result.LatestAttempt -and $result.LatestAttempt -gt $cutoff) {
        $result.Warnings.Add('recent-attempt-without-success')
    }
    return [pscustomobject] $result
}

function ConvertTo-InactiveCsvCell {
    param([AllowNull()] [object] $Value)
    $text = [string] $Value
    # Quoting alone does not stop spreadsheet formula injection.
    if ($text -match '^[\s\p{Cf}]*[=+@-]' -or $text -match '^[\t\r\n]') { $text = "'" + $text }
    return '"' + $text.Replace('"', '""') + '"'
}

function Format-InactiveNumber { param([long] $Value) return $Value.ToString('N0', [cultureinfo] 'pt-BR') }
function Format-InactiveUtc { param([DateTimeOffset] $Value) return $Value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [cultureinfo]::InvariantCulture) }

function Get-InactiveLicenseNames {
    param([object] $User, [hashtable] $SkuNames)
    $property = $User.PSObject.Properties['assignedLicenses']
    if ($null -eq $property -or $null -eq $property.Value -or $property.Value -isnot [array]) {
        return [pscustomobject]@{ State = 'unknown'; Names = @(); Keys = @() }
    }
    $names = [System.Collections.Generic.List[string]]::new()
    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($license in $property.Value) {
        $key = [string] (Get-InactiveField $license 'skuId')
        $guid = [guid]::Empty
        if (-not [guid]::TryParse($key, [ref] $guid)) { throw [System.InvalidOperationException]::new('Invalid license identifier.') }
        $key = $guid.ToString('D')
        if ($keys.Add($key)) {
            $names.Add($(if ($SkuNames.ContainsKey($key)) { $SkuNames[$key] } else { "SKU $key (nome indisponível)" }))
        }
    }
    $names.Sort([System.StringComparer]::OrdinalIgnoreCase)
    return [pscustomobject]@{ State = $(if ($names.Count -gt 0) { 'yes' } else { 'no' }); Names = $names.ToArray(); Keys = @($keys) }
}

function New-InactiveAggregate {
    return @{
        Duplicates = 0L; CsvCharacters = 0L
        Total = 0L; Active = 0L; Inactive = 0L; Initial = 0L; Indeterminate = 0L
        Members = 0L; Guests = 0L; OtherTypes = 0L
        Pending = 0L; Accepted = 0L; OtherGuests = 0L; PendingInactive = 0L
        InactiveMembers = 0L; InactiveGuests = 0L; InactiveOtherTypes = 0L
        InactiveEnabled = 0L; InactiveDisabled = 0L; InactiveUnknownEnabled = 0L
        Licensed = 0L; Unlicensed = 0L; UnknownLicense = 0L
        InactiveLicensed = 0L; InactiveUnlicensed = 0L; InactiveUnknownLicense = 0L
        InactiveEnabledLicensed = 0L; DisabledLicensed = 0L
        Days90 = 0L; Days180 = 0L; Days365 = 0L; NoRecordedSuccess = 0L
        InactiveEvidence = @{}; IndeterminateReasons = @{}; QualityWarnings = @{}; ActivityShapes = @{}
        IndeterminateSample = [System.Collections.Generic.List[object]]::new()
        Licenses = @{}; Sample = [System.Collections.Generic.List[object]]::new()
    }
}

function Add-InactiveUser {
    param([object] $User, [DateTimeOffset] $AsOfUtc, [DateTimeOffset] $ObservedAtUtc, [hashtable] $Stats, [hashtable] $SkuNames, [System.IO.TextWriter] $CsvWriter)
    $Stats.Total++
    $classification = Get-CloudOpsInactiveUserClassification -User $User -AsOfUtc $AsOfUtc -ObservedAtUtc $ObservedAtUtc -ActivitySelected
    $Stats.ActivityShapes[$classification.ActivityShape]++
    foreach ($warning in $classification.Warnings) { $Stats.QualityWarnings[$warning]++ }
    if ($classification.State -eq 'inactive') { $Stats.InactiveEvidence[$classification.Evidence]++ }
    if ($classification.State -eq 'indeterminate') {
        $Stats.IndeterminateReasons[$classification.Reason]++
        if ($Stats.IndeterminateSample.Count -lt 50) {
            $Stats.IndeterminateSample.Add([ordered]@{
                Name = [string] (Get-InactiveField $User 'displayName')
                UPN = [string] (Get-InactiveField $User 'userPrincipalName')
                Reason = $classification.Reason
            })
        }
    }
    switch ($classification.State) {
        'active' { $Stats.Active++ }; 'inactive' { $Stats.Inactive++ }
        'initial' { $Stats.Initial++ }; default { $Stats.Indeterminate++ }
    }
    $type = [string] (Get-InactiveField $User 'userType')
    $invitation = [string] (Get-InactiveField $User 'externalUserState')
    $enabled = Get-InactiveField $User 'accountEnabled'
    $licenses = Get-InactiveLicenseNames -User $User -SkuNames $SkuNames
    $typeLabel = switch ($type) { 'Member' { $Stats.Members++; 'Membro' }; 'Guest' { $Stats.Guests++; 'Convidado' }; default { $Stats.OtherTypes++; 'Não informado' } }
    $inviteLabel = 'Não se aplica'
    if ($type -eq 'Guest') {
        $inviteLabel = switch ($invitation) {
            'PendingAcceptance' { $Stats.Pending++; 'Convite pendente' }
            'Accepted' { $Stats.Accepted++; 'Convite aceito' }
            default { $Stats.OtherGuests++; 'Estado do convite não informado' }
        }
    }
    switch ($licenses.State) { 'yes' { $Stats.Licensed++ }; 'no' { $Stats.Unlicensed++ }; default { $Stats.UnknownLicense++ } }
    if ($enabled -is [bool] -and -not $enabled -and $licenses.State -eq 'yes') { $Stats.DisabledLicensed++ }
    foreach ($key in $licenses.Keys) {
        if (-not $Stats.Licenses.ContainsKey($key)) {
            if ($Stats.Licenses.Count -ge 10000) { throw [System.InvalidOperationException]::new('License catalog limit exceeded.') }
            $Stats.Licenses[$key] = @{ Name = $(if ($SkuNames.ContainsKey($key)) { $SkuNames[$key] } else { "SKU $key (nome indisponível)" }); Total = 0L; Inactive = 0L }
        }
        $Stats.Licenses[$key].Total++
        if ($classification.State -eq 'inactive') { $Stats.Licenses[$key].Inactive++ }
    }
    if ($classification.State -ne 'inactive') { return }
    switch ($type) { 'Member' { $Stats.InactiveMembers++ }; 'Guest' { $Stats.InactiveGuests++ }; default { $Stats.InactiveOtherTypes++ } }
    if ($type -eq 'Guest' -and $invitation -eq 'PendingAcceptance') { $Stats.PendingInactive++ }
    if ($enabled -isnot [bool]) { $Stats.InactiveUnknownEnabled++ }
    elseif ($enabled) { $Stats.InactiveEnabled++ } else { $Stats.InactiveDisabled++ }
    switch ($licenses.State) {
        'yes' { $Stats.InactiveLicensed++; if ($enabled -is [bool] -and $enabled) { $Stats.InactiveEnabledLicensed++ } }
        'no' { $Stats.InactiveUnlicensed++ }; default { $Stats.InactiveUnknownLicense++ }
    }
    if ($null -eq $classification.Days) { $Stats.NoRecordedSuccess++ }
    elseif ($classification.Days -ge 365) { $Stats.Days365++ }
    elseif ($classification.Days -ge 180) { $Stats.Days180++ }
    else { $Stats.Days90++ }

    $row = [ordered]@{
        'Nome' = [string] (Get-InactiveField $User 'displayName')
        'UPN' = [string] (Get-InactiveField $User 'userPrincipalName')
        'Tipo de Conta' = $typeLabel
        'Tipo de convidado' = $inviteLabel
        'Dias sem login bem-sucedido' = $(if ($null -ne $classification.Days) { $classification.Days.ToString([cultureinfo]::InvariantCulture) } else { 'Sem login bem-sucedido registrado' })
        'Data Criação (UTC)' = $(if ($null -ne $classification.Created) { Format-InactiveUtc $classification.Created } else { 'Não informada' })
        'Licenciado' = $(switch ($licenses.State) { 'yes' { 'Sim' }; 'no' { 'Não' }; default { 'Não informado' } })
        'Licença' = $(if ($licenses.State -eq 'unknown') { 'Não informada' } elseif ($licenses.Names.Count -eq 0) { 'Sem licença' } else { $licenses.Names -join ' | ' })
    }
    $line = ($(foreach ($value in $row.Values) { ConvertTo-InactiveCsvCell $value })) -join ';'
    $Stats.CsvCharacters += $line.Length + 2
    $CsvWriter.WriteLine($line)
    if ($Stats.Sample.Count -lt 50) { $Stats.Sample.Add($row) }
}

function Write-CloudOpsInactiveUsersArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $AccessToken,
        [Parameter(Mandatory)] [string] $TenantId,
        [Parameter(Mandatory)] [string] $ExecutionId,
        [Parameter(Mandatory)] [System.IO.MemoryStream] $ArchiveStream,
        [DateTimeOffset] $AsOfUtc = [DateTimeOffset]::UtcNow,
        [System.Net.Http.HttpClient] $HttpClient,
        # Test-only dependency injection; never accepted from execution options.
        [scriptblock] $DelayAction = { param([int] $Milliseconds) if ($Milliseconds -gt 0) { Start-Sleep -Milliseconds $Milliseconds } },
        [ValidateRange(1, 500000)] [int] $MaximumUsers = 500000,
        [ValidateRange(1, 134217728)] [int] $MaximumCsvCharacters = 128MB,
        [ValidateRange(1, 25165824)] [int] $MaximumArchiveBytes = 24MB
    )
    $TenantId = Assert-CloudOpsTenantId $TenantId
    $ExecutionId = Assert-CloudOpsIdentifier $ExecutionId 'executionId'
    $AccessToken = Assert-CloudOpsTransientAccessToken $AccessToken
    if ($ArchiveStream.Length -ne 0) { throw [System.ArgumentException]::new('Artifact stream must be empty.') }
    $stats = New-InactiveAggregate
    $counters = @{ Requests = 0L }
    $skuNames = @{}
    $seenUsers = [System.Collections.Generic.HashSet[guid]]::new()
    $archive = $null
    $csvWriter = $null
    $reportBytes = $null
    $complete = $false
    $ownsClient = $null -eq $HttpClient
    if ($ownsClient) {
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $HttpClient = [System.Net.Http.HttpClient]::new($handler, $true)
    }
    $graphParameters = @{ AccessToken = $AccessToken; HttpClient = $HttpClient; MaximumAttempts = 5; MaximumRetryAfterSeconds = 300; DelayAction = $DelayAction }
    try {
        Write-CloudOpsProgress -Stage 'INITIALIZING' -Progress 5
        Write-CloudOpsProgress -Stage 'AUTHENTICATING' -Progress 15
        $organization = Invoke-CloudOpsGraphRequest @graphParameters -Path '/organization?$select=id,displayName'
        $counters.Requests++
        $organizations = @(Get-InactiveField $organization 'value')
        if ($organizations.Count -ne 1 -or [string] (Get-InactiveField $organizations[0] 'id') -ine $TenantId) {
            throw [System.InvalidOperationException]::new('Organization response does not match the execution tenant.')
        }
        $tenantName = [string] (Get-InactiveField $organizations[0] 'displayName')
        if ([string]::IsNullOrWhiteSpace($tenantName)) { $tenantName = 'Nome indisponível' }
        $organization = $null
        $organizations = $null
        # Static product metadata is code, not collected tenant data. No runtime
        # HTTP lookup, external chart library, temporary report or token cache.
        $friendlyNames = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'knowledge/license-names.json')) | ConvertFrom-Json -AsHashtable
        Get-CloudOpsGraphCollection @graphParameters -Path '/subscribedSkus?$select=skuId,skuPartNumber' -MaximumPages 20 -PageCompletedAction { param($pageNumber) $counters.Requests++ } | ForEach-Object {
            $skuId = Assert-CloudOpsTenantId ([string] (Get-InactiveField $_ 'skuId'))
            $part = [string] (Get-InactiveField $_ 'skuPartNumber')
            if ($skuNames.Count -ge 10000 -or [string]::IsNullOrWhiteSpace($part)) { throw 'Invalid subscription metadata.' }
            $skuNames[$skuId] = if ($friendlyNames.ContainsKey($part)) { "$($friendlyNames[$part]) ($part)" } else { $part }
        }

        $utf8 = [System.Text.UTF8Encoding]::new($false)
        $archive = [System.IO.Compression.ZipArchive]::new($ArchiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $true, $utf8)
        $csvEntry = $archive.CreateEntry('usuarios-inativos.csv', [System.IO.Compression.CompressionLevel]::Optimal)
        $csvWriter = [System.IO.StreamWriter]::new($csvEntry.Open(), [System.Text.UTF8Encoding]::new($true), 65536, $false)
        $csvWriter.NewLine = "`r`n"
        $headers = @('Nome', 'UPN', 'Tipo de Conta', 'Tipo de convidado', 'Dias sem login bem-sucedido', 'Data Criação (UTC)', 'Licenciado', 'Licença')
        $csvWriter.WriteLine((($headers | ForEach-Object { ConvertTo-InactiveCsvCell $_ }) -join ';'))
        Write-CloudOpsProgress -Stage 'QUERYING_GRAPH' -Progress 25
        $pageCompleted = {
            param($pageNumber)
            $counters.Requests++
            $csvWriter.Flush()
            if ($stats.CsvCharacters -gt $MaximumCsvCharacters -or $ArchiveStream.Length -gt $MaximumArchiveBytes) { throw 'Artifact limit exceeded.' }
            Write-CloudOpsPublicMetrics -PublicMetrics @{ objectsAnalyzed = [long] $stats.Total; findings = [long] $stats.Inactive; requestsCompleted = [long] $counters.Requests }
            Write-CloudOpsProgress -Stage 'QUERYING_GRAPH' -Progress ([Math]::Min(75, 25 + $pageNumber))
        }
        $path = '/users?$select=id,displayName,userPrincipalName,userType,externalUserState,accountEnabled,createdDateTime,assignedLicenses,signInActivity&$top=500'
        Get-CloudOpsGraphCollection @graphParameters -Path $path -MaximumPages 1000 -MinimumPageIntervalMilliseconds 6100 -PageCompletedAction $pageCompleted | ForEach-Object {
            $id = [guid] (Assert-CloudOpsTenantId ([string] (Get-InactiveField $_ 'id')))
            if (-not $seenUsers.Add($id)) { $stats.Duplicates++ }
            else {
                if ($stats.Total -ge $MaximumUsers) { throw 'User inventory limit exceeded.' }
                Add-InactiveUser -User $_ -AsOfUtc $AsOfUtc -ObservedAtUtc ([DateTimeOffset]::UtcNow) -Stats $stats -SkuNames $skuNames -CsvWriter $csvWriter
                if ($stats.CsvCharacters -gt $MaximumCsvCharacters) { throw 'CSV limit exceeded.' }
            }
        }
        $csvWriter.Dispose()
        $csvWriter = $null
        $AccessToken = $null
        $graphParameters.Clear()
        Write-CloudOpsProgress -Stage 'GENERATING_REPORT' -Progress 85
        $html = New-InactiveReportHtml -Stats $stats -TenantId $TenantId -TenantName $tenantName -ExecutionId $ExecutionId -AsOfUtc $AsOfUtc -Requests $counters.Requests
        $reportBytes = $utf8.GetBytes($html)
        $html = $null
        $entryStream = $archive.CreateEntry('report.html', [System.IO.Compression.CompressionLevel]::Optimal).Open()
        try { $entryStream.Write($reportBytes, 0, $reportBytes.Length) }
        finally { $entryStream.Dispose() }
        $archive.Dispose()
        $archive = $null
        if ($ArchiveStream.Length -gt $MaximumArchiveBytes) { throw 'Artifact limit exceeded.' }
        $complete = $true
        return [ordered]@{ graphReachable = $true; objectsAnalyzed = [long] $stats.Total; findings = [long] $stats.Inactive; requestsCompleted = [long] $counters.Requests }
    }
    finally {
        if ($null -ne $csvWriter) { $csvWriter.Dispose() }
        if ($null -ne $archive) { $archive.Dispose() }
        if ($null -ne $reportBytes) { [Array]::Clear($reportBytes, 0, $reportBytes.Length) }
        if (-not $complete) {
            $buffer = $ArchiveStream.GetBuffer()
            [Array]::Clear($buffer, 0, $buffer.Length)
            $ArchiveStream.SetLength(0)
        }
        $AccessToken = $null
        $graphParameters.Clear()
        if ($ownsClient) { $HttpClient.Dispose() }
        $seenUsers.Clear()
        $skuNames.Clear()
        $stats.Sample.Clear()
        $stats.IndeterminateSample.Clear()
        $stats.Clear()
        $pageCompleted = $null
        $html = $null
    }
}

Export-ModuleMember -Function @('Get-CloudOpsInactiveUserClassification', 'Write-CloudOpsInactiveUsersArchive')
