#requires -Version 7.2
[CmdletBinding()]
param([switch] $EmitPreview, [ValidateRange(0, 500000)] [int] $ScaleUsers = 0)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
trap {
    [Console]::Error.WriteLine(('FAIL: synthetic inactive-users validation at line {0}: {1}' -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message))
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}
function Assert-Test { param([bool] $Condition, [string] $Message) if (-not $Condition) { throw [System.InvalidOperationException]::new($Message) } }
$engineRoot = Split-Path -Parent $PSScriptRoot
function Get-TestFileSnapshot {
    # In the isolated container the rest of the filesystem is read-only.
    # No paths or content from this check are printed, even on failure.
    $roots = @($engineRoot)
    if (-not $IsWindows) { $roots += '/tmp' }
    return (@(foreach ($root in $roots) {
        Get-ChildItem -LiteralPath $root -Recurse -Force -File | Sort-Object FullName | ForEach-Object {
            # FileInfo also represents Unix sockets/FIFOs; never try to hash
            # those. pwsh's own startup timing cache is not assessment data.
            if ($IsLinux -and (-not ([string] $_.UnixMode).StartsWith('-') -or
                $_.FullName -eq (Join-Path $HOME '.cache/powershell/StartupProfileData-NonInteractive'))) { return }
            $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }) -join "`n")
}
$beforeFiles = Get-TestFileSnapshot
Import-Module (Join-Path $engineRoot 'inactive-users/CloudOps.InactiveUsers.psm1') -Force -DisableNameChecking
$delays = [System.Collections.Generic.List[int]]::new()
$PSDefaultParameterValues['Write-CloudOpsInactiveUsersArchive:DelayAction'] = { { param([int] $Milliseconds) $delays.Add($Milliseconds) } }
$PSDefaultParameterValues['Get-CloudOpsInactiveUserClassification:ActivitySelected'] = $true
$reference = [DateTimeOffset] '2026-09-07T12:00:00Z'
$tenantId = '22222222-2222-4222-8222-222222222222'
$skuId = '33333333-3333-4333-8333-333333333333'
$unknownSku = '44444444-4444-4444-8444-444444444444'
$script:userSequence = 0
function New-TestUser {
    param([AllowNull()] [object] $Success = $null, [AllowNull()] [object] $Created = '2025-01-01T00:00:00Z', [string] $Type = 'Member')
    $script:userSequence++
    return [pscustomobject][ordered]@{
        id = ('00000000-0000-4000-8000-{0:D12}' -f $script:userSequence)
        displayName = "Synthetic account $script:userSequence"
        userPrincipalName = "synthetic-$script:userSequence@example.invalid"
        userType = $Type; externalUserState = $null; accountEnabled = $true
        createdDateTime = $Created; assignedLicenses = @()
        signInActivity = [pscustomobject]@{ lastSuccessfulSignInDateTime = $Success; lastSignInDateTime = $null; lastNonInteractiveSignInDateTime = $null }
    }
}

# Exact UTC cutoff, non-interactive success and unsuccessful attempts.
foreach ($case in @(
    @{ Success = $reference.AddDays(-90); Created = '2025-01-01T00:00:00Z'; State = 'inactive'; Days = 90 }
    @{ Success = $reference.AddDays(-90).AddSeconds(1); Created = '2025-01-01T00:00:00Z'; State = 'active'; Days = 89 }
    @{ Success = '2026-06-09T15:00:00+03:00'; Created = '2025-01-01T00:00:00Z'; State = 'inactive'; Days = 90 }
    @{ Success = $null; Created = $reference.AddDays(-90); State = 'inactive'; Days = $null }
    @{ Success = $null; Created = $reference.AddDays(-90).AddSeconds(1); State = 'initial'; Days = $null }
    @{ Success = $null; Created = $reference; State = 'initial'; Days = $null }
    @{ Success = $null; Created = $null; State = 'indeterminate'; Days = $null }
    @{ Success = 'invalid'; Created = '2025-01-01T00:00:00Z'; State = 'indeterminate'; Days = $null }
    @{ Success = $reference.AddSeconds(1); Created = '2025-01-01T00:00:00Z'; State = 'indeterminate'; Days = $null }
    @{ Success = $reference.AddDays(-100); Created = $reference.AddDays(-50); State = 'indeterminate'; Days = $null }
    @{ Success = $null; Created = $reference.AddDays(1); State = 'indeterminate'; Days = $null }
    @{ Success = $reference.AddDays(-1); Created = 'invalid'; State = 'active'; Days = 1 }
    @{ Success = $reference.AddDays(-100); Created = 'invalid'; State = 'inactive'; Days = 100 }
    @{ Success = $reference.AddDays(-1); Created = $null; State = 'active'; Days = 1 }
    @{ Success = $null; Created = 'invalid'; State = 'indeterminate'; Days = $null }
)) {
    $user = New-TestUser -Success $case.Success -Created $case.Created
    $classification = Get-CloudOpsInactiveUserClassification -User $user -AsOfUtc $reference
    Assert-Test ($classification.State -eq $case.State) 'UTC inactivity or creation boundary failed.'
    Assert-Test ($classification.Days -eq $case.Days) 'Exact completed days failed.'
}
$attempts = New-TestUser -Success ($reference.AddDays(-100))
$attempts.signInActivity.lastSignInDateTime = $reference.AddMinutes(-5)
$attempts.signInActivity.lastNonInteractiveSignInDateTime = $reference.AddMinutes(-3)
Assert-Test ((Get-CloudOpsInactiveUserClassification $attempts $reference).State -eq 'inactive') 'A failed attempt incorrectly made the account active.'
$missing = New-TestUser
$missing.PSObject.Properties.Remove('signInActivity')
Assert-Test ((Get-CloudOpsInactiveUserClassification $missing $reference).State -eq 'inactive') 'Documented activity omission did not use creation grace.'
Assert-Test ((Get-CloudOpsInactiveUserClassification $missing $reference -ActivitySelected:$false).Reason -eq 'activity-not-selected') 'Unselected data was treated as absence of history.'
$missingNew = New-TestUser -Created ($reference.AddDays(-5))
$missingNew.PSObject.Properties.Remove('signInActivity')
Assert-Test ((Get-CloudOpsInactiveUserClassification $missingNew $reference).State -eq 'initial') 'New omitted history bypassed creation grace.'
$emptyActivity = New-TestUser
$emptyActivity.signInActivity = [pscustomobject]@{}
Assert-Test ((Get-CloudOpsInactiveUserClassification $emptyActivity $reference).State -eq 'indeterminate') 'Unknown activity schema was treated as no success.'

# Observation time is independent from the fixed population cutoff.
$duringScan = New-TestUser -Success ($reference.AddMinutes(5))
$classification = Get-CloudOpsInactiveUserClassification $duringScan $reference -ObservedAtUtc ($reference.AddMinutes(10))
Assert-Test ($classification.State -eq 'active' -and $classification.Days -eq 0 -and $classification.Warnings.Contains('success-during-collection')) 'Success during collection was treated as future or negative days.'
$duringScan.createdDateTime = $reference.AddMinutes(1)
Assert-Test ((Get-CloudOpsInactiveUserClassification $duringScan $reference -ObservedAtUtc ($reference.AddMinutes(10))).State -eq 'active') 'New account used during collection was rejected.'
$duringScan.signInActivity.lastSuccessfulSignInDateTime = $null
Assert-Test ((Get-CloudOpsInactiveUserClassification $duringScan $reference -ObservedAtUtc ($reference.AddMinutes(10))).State -eq 'initial') 'Creation during collection was treated as an invalid future.'
$duringScan.signInActivity.lastSuccessfulSignInDateTime = $reference.AddMinutes(11)
Assert-Test ((Get-CloudOpsInactiveUserClassification $duringScan $reference -ObservedAtUtc ($reference.AddMinutes(10))).Reason -eq 'future-success') 'Genuinely future activity was accepted.'
$cutoffStable = New-TestUser -Success ($reference.AddDays(-90).AddMinutes(1))
Assert-Test ((Get-CloudOpsInactiveUserClassification $cutoffStable $reference -ObservedAtUtc ($reference.AddMinutes(55))).State -eq 'active') 'Cutoff drifted during pagination.'

$noCreation = New-TestUser -Created $null
$invalidSuccess = New-TestUser -Success 'invalid'
$invalidSuccess.userPrincipalName = '<script>unsafe()</script>@example.invalid'
$legacyRecent = New-TestUser
$legacyRecent.signInActivity.PSObject.Properties.Remove('lastSuccessfulSignInDateTime')
$legacyRecent.signInActivity.lastSignInDateTime = $reference.AddMinutes(-5)
$legacyOld = New-TestUser
$legacyOld.signInActivity.PSObject.Properties.Remove('lastSuccessfulSignInDateTime')
$legacyOld.signInActivity.lastNonInteractiveSignInDateTime = $reference.AddDays(-120)
$legacyClassification = Get-CloudOpsInactiveUserClassification $legacyOld $reference
Assert-Test ($legacyClassification.State -eq 'inactive' -and $legacyClassification.Evidence -eq 'historical-attempts' -and $null -eq $legacyClassification.Days) 'Old attempts fallback invented a successful login date.'
Assert-Test ((Get-CloudOpsInactiveUserClassification $legacyRecent $reference).Reason -eq 'missing-success-without-old-attempts') 'Recent attempts with omitted success were treated as known access or inactivity.'
$legacyPartial = New-TestUser
$legacyPartial.signInActivity.PSObject.Properties.Remove('lastSuccessfulSignInDateTime')
$legacyPartial.signInActivity.PSObject.Properties.Remove('lastSignInDateTime')
$legacyPartial.signInActivity.lastNonInteractiveSignInDateTime = $reference.AddDays(-120)
Assert-Test ((Get-CloudOpsInactiveUserClassification $legacyPartial $reference).Reason -eq 'invalid-activity-schema') 'Incomplete interactive/noninteractive coverage became old history.'
$nullWithAttempt = New-TestUser
$nullWithAttempt.signInActivity.lastSignInDateTime = $reference.AddDays(-1)
$classification = Get-CloudOpsInactiveUserClassification $nullWithAttempt $reference
Assert-Test ($classification.State -eq 'inactive' -and $classification.Warnings.Contains('recent-attempt-without-success')) 'Explicit absent success with recent attempts lacks a review warning.'
foreach ($badActivity in @('', 'invalid', @(), 123, $false)) {
    $badSchema = New-TestUser
    $badSchema.signInActivity = $badActivity
    Assert-Test ((Get-CloudOpsInactiveUserClassification $badSchema $reference).Reason -eq 'invalid-activity-schema') 'Malformed activity became no history.'
}
foreach ($badDate in @('', ' ', @(), @('2026-01-01T00:00:00Z'), [pscustomobject]@{}, $false, 123)) {
    $user = New-TestUser -Success $badDate
    Assert-Test ((Get-CloudOpsInactiveUserClassification $user $reference).Reason -eq 'invalid-success') 'Malformed success date became null or a valid scalar.'
}
foreach ($case in @(
    @{ Success = $null; Attempt = 'invalid'; Reason = 'invalid-attempt' }
    @{ Success = $null; Attempt = $reference.AddSeconds(1); Reason = 'future-attempt' }
    @{ Success = $null; Attempt = '2024-01-01T00:00:00Z'; Reason = 'attempt-before-creation' }
    @{ Success = $reference.AddDays(-1); Attempt = 'invalid'; Reason = 'successful-sign-in' }
)) {
    $user = New-TestUser -Success $case.Success
    $user.signInActivity.lastSignInDateTime = $case.Attempt
    Assert-Test ((Get-CloudOpsInactiveUserClassification $user $reference).Reason -eq $case.Reason) 'Supplementary attempt quality handling failed.'
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class InactiveUsersTestHandler : HttpMessageHandler {
    public readonly Queue<HttpResponseMessage> Responses = new Queue<HttpResponseMessage>();
    public readonly List<string> Uris = new List<string>();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
        if (request.Method != HttpMethod.Get || request.RequestUri.Host != "graph.microsoft.com") throw new Exception("Unexpected request");
        Uris.Add(request.RequestUri.AbsoluteUri);
        return Task.FromResult(Responses.Count > 0 ? Responses.Dequeue() : new HttpResponseMessage(HttpStatusCode.Forbidden));
    }
}
'@
function New-TestResponse {
    param([object] $Value, [int] $Status = 200)
    $response = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode] $Status)
    $response.Content = [System.Net.Http.StringContent]::new(($Value | ConvertTo-Json -Depth 16 -Compress), [System.Text.Encoding]::UTF8, 'application/json')
    return $response
}
function New-TestFixture {
    param([AllowEmptyCollection()] [object[]] $Users = @(), [switch] $UnsafeNextLink, [switch] $Forbidden)
    $handler = [InactiveUsersTestHandler]::new()
    $handler.Responses.Enqueue((New-TestResponse @{ value = @(@{ id = $tenantId; displayName = 'Tenant sintético <script>unsafe()</script>' }) }))
    $handler.Responses.Enqueue((New-TestResponse @{ value = @(@{ skuId = $skuId; skuPartNumber = 'SPE_E3' }) }))
    if ($Forbidden) { $handler.Responses.Enqueue((New-TestResponse @{ error = 'do-not-reflect-upstream' } 403)) }
    else {
        $split = [Math]::Min(3, $Users.Count)
        $first = @($Users | Select-Object -First $split)
        $next = if ($UnsafeNextLink) { 'https://attacker.invalid/v1.0/users' } else { 'https://graph.microsoft.com/v1.0/users?$skiptoken=synthetic' }
        $handler.Responses.Enqueue((New-TestResponse @{ value = $first; '@odata.nextLink' = $next }))
        $handler.Responses.Enqueue((New-TestResponse @{ value = @($Users | Select-Object -Skip $split) }))
    }
    return [pscustomobject]@{ Handler = $handler; Client = [System.Net.Http.HttpClient]::new($handler, $true) }
}
function Read-ZipText {
    param([System.IO.Compression.ZipArchive] $Zip, [string] $Name)
    $reader = [System.IO.StreamReader]::new($Zip.GetEntry($Name).Open(), [System.Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Clear-TestStream {
    param([System.IO.MemoryStream] $Stream)
    $bytes = $Stream.GetBuffer()
    [Array]::Clear($bytes, 0, $bytes.Length)
    $Stream.Dispose()
}

$old = New-TestUser -Success ($reference.AddDays(-90))
$old.displayName = '=HYPERLINK("https://invalid","injection"); <img src=x onerror=alert(1)>'
$old.assignedLicenses = @([pscustomobject]@{ skuId = $skuId })
$active = New-TestUser -Success ($reference.AddDays(-1))
$pending = New-TestUser -Created ($reference.AddDays(-90)) -Type Guest
$pending.externalUserState = 'PendingAcceptance'
$initial = New-TestUser -Created ($reference.AddDays(-1)) -Type Guest
$initial.externalUserState = 'PendingAcceptance'
$accepted = New-TestUser -Type Guest
$accepted.externalUserState = 'Accepted'
$accepted.assignedLicenses = @([pscustomobject]@{ skuId = $skuId }, [pscustomobject]@{ skuId = $unknownSku })
$disabled = New-TestUser -Success ($reference.AddDays(-400))
$disabled.accountEnabled = $false
$disabled.assignedLicenses = @([pscustomobject]@{ skuId = $skuId })
$unknownLicense = New-TestUser -Success ($reference.AddDays(-180)) -Type Guest
$unknownLicense.PSObject.Properties.Remove('assignedLicenses')
$unknownLicense.accountEnabled = $null
$explicitNull = New-TestUser
$explicitNull.signInActivity = $null
$users = @($old, $active, $pending, $initial, $accepted, $missing, $disabled, $attempts, $unknownLicense, $explicitNull, $old, $noCreation, $invalidSuccess, $legacyRecent, $legacyOld)
$fixture = New-TestFixture $users
$stream = [System.IO.MemoryStream]::new()
$zip = $null
try {
    $metrics = Write-CloudOpsInactiveUsersArchive -AccessToken 'synthetic-opaque-token' -TenantId $tenantId -ExecutionId 'EXE-550e8400-e29b-41d4-a716-446655440000' -ArchiveStream $stream -AsOfUtc $reference -HttpClient $fixture.Client
    Assert-Test ($metrics.objectsAnalyzed -eq 14 -and $metrics.findings -eq 9 -and $metrics.requestsCompleted -eq 4) 'Population, inactive count, pagination or deduplication failed.'
    Assert-Test ($fixture.Handler.Uris.Count -eq 4 -and $fixture.Handler.Uris[2].Contains('signInActivity') -and $fixture.Handler.Uris[2].Contains('$top=500')) 'Selected Graph fields or page size failed.'
    Assert-Test ($delays.Count -eq 1 -and $delays[0] -gt 0 -and $delays[0] -le 6100) 'Page pacing did not account for processing time.'
    $stream.Position = 0
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
    Assert-Test ((@($zip.Entries.FullName | Sort-Object) -join ',') -ceq 'report.html,usuarios-inativos.csv') 'Expected exactly HTML and CSV in ZIP.'
    $csv = Read-ZipText $zip 'usuarios-inativos.csv'
    $html = Read-ZipText $zip 'report.html'
    $rows = @($csv | ConvertFrom-Csv -Delimiter ';')
    Assert-Test ($rows.Count -eq 9) 'CSV contains non-inactive users or duplicates.'
    foreach ($excluded in @($active, $initial, $noCreation, $invalidSuccess, $legacyRecent)) {
        Assert-Test ($excluded.userPrincipalName -notin $rows.UPN) 'Active, initial or indeterminate account leaked into CSV.'
    }
    $headers = @('Nome', 'UPN', 'Tipo de Conta', 'Tipo de convidado', 'Dias sem login bem-sucedido', 'Data Criação (UTC)', 'Licenciado', 'Licença')
    Assert-Test ((@($rows[0].PSObject.Properties.Name) -join '|') -ceq ($headers -join '|')) 'CSV columns do not match the requested contract.'
    Assert-Test ($rows[0].Nome.StartsWith("'=HYPERLINK")) 'CSV formula injection was not neutralized.'
    Assert-Test ($rows[0].'Dias sem login bem-sucedido' -ceq '90') 'CSV exact days were rounded incorrectly.'
    Assert-Test ($rows[0].'Data Criação (UTC)' -ceq '2025-01-01T00:00:00Z') 'Creation timestamp is not canonical UTC.'
    Assert-Test ($rows[0].Licença -ceq 'Microsoft 365 E3 (SPE_E3)') 'License ID-to-name mapping failed.'
    Assert-Test ($rows[1].'Tipo de convidado' -ceq 'Convite pendente') 'Pending invite classification failed.'
    Assert-Test ($rows[1].'Dias sem login bem-sucedido' -ceq 'Sem login bem-sucedido registrado') 'Missing historical success was overstated.'
    Assert-Test ($rows[2].'Tipo de convidado' -ceq 'Convite aceito' -and $rows[2].Licença.Contains($unknownSku)) 'Accepted invitation or unknown SKU preservation failed.'
    Assert-Test ($rows[6].Licenciado -ceq 'Não informado' -and $rows[6].'Tipo de convidado' -ceq 'Estado do convite não informado') 'Unknown license/invitation became false or accepted.'
    Assert-Test ($rows[8].'Dias sem login bem-sucedido' -ceq 'Sem login bem-sucedido registrado') 'Legacy attempts became exact days since success.'
    Assert-Test ($html.Contains('&lt;script&gt;') -and -not $html.Contains('<script') -and -not $html.Contains('<img')) 'HTML injection was not escaped.'
    Assert-Test ([regex]::Matches($html, '<svg ').Count -eq 7 -and $html.Contains('Percentuais'.ToLower()) -and -not $html.Contains('NaN')) 'Offline charts or percentage labels are missing.'
    Assert-Test (-not $html.Contains('synthetic-opaque-token') -and -not $csv.Contains('synthetic-opaque-token')) 'Graph token leaked into artifact.'
    Assert-Test ($html.Contains('período inicial') -and $html.Contains('indeterminado') -and $html.Contains('não prova')) 'Data quality and grace-period explanations are missing.'
    $decodedHtml = [System.Net.WebUtility]::HtmlDecode($html)
    Assert-Test ($decodedHtml.Contains('Evidências e qualidade dos dados') -and $decodedHtml.Contains('Data de criação não informada') -and $decodedHtml.Contains('Data de sucesso inválida') -and $decodedHtml.Contains('Campo de sucesso omitido')) 'Indeterminate reasons or evidence are missing.'
    Assert-Test ($decodedHtml.Contains('Histórico legado') -and $decodedHtml.Contains('propriedades omitidas')) 'Historical and missing-field coverage are not explained.'
    $entry = $zip.GetEntry('usuarios-inativos.csv').Open()
    try { $bom = [byte[]]::new(3); [void] $entry.Read($bom, 0, 3); Assert-Test (($bom -join ',') -eq '239,187,191') 'CSV UTF-8 BOM is missing.' } finally { $entry.Dispose() }
    if ($EmitPreview) { [Console]::WriteLine((@{ html = $html; csv = $csv } | ConvertTo-Json -Depth 4 -Compress)) }
}
finally { if ($null -ne $zip) { $zip.Dispose() }; Clear-TestStream $stream; $fixture.Client.Dispose() }

# Empty tenants still return a header-only CSV and meaningful, finite charts.
$fixture = New-TestFixture
$stream = [System.IO.MemoryStream]::new()
try {
    $metrics = Write-CloudOpsInactiveUsersArchive -AccessToken 'synthetic-token' -TenantId $tenantId -ExecutionId 'EXE-550e8400-e29b-41d4-a716-446655440000' -ArchiveStream $stream -AsOfUtc $reference -HttpClient $fixture.Client
    Assert-Test ($metrics.objectsAnalyzed -eq 0 -and $metrics.findings -eq 0) 'Empty tenant counts failed.'
    $stream.Position = 0
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
    try {
        Assert-Test (@((Read-ZipText $zip 'usuarios-inativos.csv') | ConvertFrom-Csv -Delimiter ';').Count -eq 0) 'Empty tenant CSV has rows.'
        $emptyHtml = Read-ZipText $zip 'report.html'
        Assert-Test ($emptyHtml.Contains('Sem contas nesta população.') -and -not $emptyHtml.Contains('NaN')) 'Empty chart handling failed.'
    } finally { $zip.Dispose() }
} finally { Clear-TestStream $stream; $fixture.Client.Dispose() }

# Absence-only and wholly indeterminate populations remain explicit, bounded,
# and independent of per-user Graph lookups.
foreach ($population in @('omitted', 'indeterminate')) {
    $diagnosticUsers = @(1..55 | ForEach-Object {
        $user = New-TestUser
        $user.PSObject.Properties.Remove('signInActivity')
        if ($population -eq 'indeterminate') { $user.createdDateTime = $null }
        $user
    })
    $fixture = New-TestFixture $diagnosticUsers
    $stream = [System.IO.MemoryStream]::new()
    try {
        $metrics = Write-CloudOpsInactiveUsersArchive -AccessToken 'synthetic-token' -TenantId $tenantId -ExecutionId 'EXE-550e8400-e29b-41d4-a716-446655440000' -ArchiveStream $stream -AsOfUtc $reference -HttpClient $fixture.Client
        $expected = if ($population -eq 'omitted') { 55 } else { 0 }
        Assert-Test ($metrics.findings -eq $expected -and $fixture.Handler.Uris.Count -eq 4) 'Absence classification made N+1 calls or lost creation guard.'
        $stream.Position = 0
        $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
        try {
            $diagnosticHtml = Read-ZipText $zip 'report.html'
            Assert-Test ($diagnosticHtml.Contains('nenhuma conta retornou um objeto de atividade')) 'All-absent population lacks a coverage warning.'
            $tableName = if ($population -eq 'omitted') { 'sample-table' } else { 'indeterminate-table' }
            $tableBody = [regex]::Match($diagnosticHtml, ('(?s)<table class="' + $tableName + '">.*?<tbody>(.*?)</tbody>')).Groups[1].Value
            Assert-Test ([regex]::Matches($tableBody, '<tr>').Count -eq 50) 'Diagnostic sample grew beyond 50 rows.'
            Assert-Test (@((Read-ZipText $zip 'usuarios-inativos.csv') | ConvertFrom-Csv -Delimiter ';').Count -eq $expected) 'Indeterminate-only CSV is not header-only.'
        } finally { $zip.Dispose() }
    } finally { Clear-TestStream $stream; $fixture.Client.Dispose() }
}

foreach ($mode in @('forbidden', 'unsafe-nextlink', 'late-failure', 'user-limit', 'csv-limit', 'archive-limit')) {
    $fixture = New-TestFixture $users -Forbidden:($mode -eq 'forbidden') -UnsafeNextLink:($mode -eq 'unsafe-nextlink')
    $stream = [System.IO.MemoryStream]::new()
    if ($mode -eq 'late-failure') {
        $pages = $fixture.Handler.Responses.ToArray()
        $fixture.Handler.Responses.Clear()
        foreach ($page in $pages[0..2]) { $fixture.Handler.Responses.Enqueue($page) }
        $pages[3].Dispose()
        $fixture.Handler.Responses.Enqueue((New-TestResponse @{ error = 'do-not-reflect-upstream' } 403))
    }
    $limits = @{}
    if ($mode -eq 'user-limit') { $limits.MaximumUsers = 1 }
    if ($mode -eq 'csv-limit') { $limits.MaximumCsvCharacters = 1 }
    if ($mode -eq 'archive-limit') { $limits.MaximumArchiveBytes = 1 }
    $failed = $false
    try {
        $null = Write-CloudOpsInactiveUsersArchive -AccessToken 'synthetic-token' -TenantId $tenantId -ExecutionId 'EXE-550e8400-e29b-41d4-a716-446655440000' -ArchiveStream $stream -AsOfUtc $reference -HttpClient $fixture.Client @limits
    } catch {
        $failed = $true
        Assert-Test (-not $_.Exception.Message.Contains('do-not-reflect-upstream')) 'Upstream error payload was reflected.'
        if ($mode -eq 'forbidden') { Assert-Test ($_.Exception.Data['CloudOpsCode'] -ceq 'GRAPH_INSUFFICIENT_PRIVILEGES') '403 was misclassified.' }
    } finally { $fixture.Client.Dispose() }
    Assert-Test ($failed -and $stream.Length -eq 0) "Failure did not discard the partial artifact: $mode"
    Clear-TestStream $stream
}

# Generate one synthetic page on demand, never preload the simulated tenant.
# This exercises the same HTTP parser, classifier and streaming ZIP as production.
if ($ScaleUsers -gt 0) {
    Add-Type -TypeDefinition @'
public sealed class InactiveUsersScaleHandler : System.Net.Http.HttpMessageHandler {
    public int Total;
    public int Emitted;
    public int Requests;
    protected override System.Threading.Tasks.Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, System.Threading.CancellationToken token) {
        Requests++;
        string json;
        if (request.RequestUri.AbsolutePath.EndsWith("/organization")) json = "{\"value\":[{\"id\":\"22222222-2222-4222-8222-222222222222\",\"displayName\":\"Synthetic scale tenant\"}]}";
        else if (request.RequestUri.AbsolutePath.EndsWith("/subscribedSkus")) json = "{\"value\":[]}";
        else {
            var users = new System.Collections.Generic.List<object>();
            for (int n = 0; n < 500 && Emitted < Total; n++) {
                int id = ++Emitted;
                var user = new System.Collections.Generic.Dictionary<string, object> {
                    ["id"] = "00000000-0000-4000-8000-" + id.ToString("D12"), ["displayName"] = "Synthetic " + id,
                    ["userPrincipalName"] = "synthetic-" + id + "@example.invalid", ["userType"] = "Member", ["accountEnabled"] = true,
                    ["createdDateTime"] = "2025-01-01T00:00:00Z", ["assignedLicenses"] = new object[0] };
                // Exercise each operational evidence path without N+1 calls.
                if (id % 4 == 0) user["signInActivity"] = new { lastSuccessfulSignInDateTime = "2026-01-01T00:00:00Z" };
                else if (id % 4 == 1) user["signInActivity"] = null;
                else if (id % 4 == 2) user["signInActivity"] = new { lastSignInDateTime = "2026-01-01T00:00:00Z", lastNonInteractiveSignInDateTime = (string)null };
                users.Add(user);
            }
            var page = new System.Collections.Generic.Dictionary<string, object> { ["value"] = users };
            if (Emitted < Total) page["@odata.nextLink"] = "https://graph.microsoft.com/v1.0/users?$skiptoken=" + Emitted;
            json = System.Text.Json.JsonSerializer.Serialize(page);
        }
        var response = new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.OK);
        response.Content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");
        return System.Threading.Tasks.Task.FromResult(response);
    }
}
'@
    $handler = [InactiveUsersScaleHandler]::new()
    $handler.Total = $ScaleUsers
    $client = [System.Net.Http.HttpClient]::new($handler, $true)
    $stream = [System.IO.MemoryStream]::new()
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $metrics = Write-CloudOpsInactiveUsersArchive -AccessToken 'synthetic-token' -TenantId $tenantId -ExecutionId 'EXE-550e8400-e29b-41d4-a716-446655440000' -ArchiveStream $stream -AsOfUtc $reference -HttpClient $client
        Assert-Test ($metrics.objectsAnalyzed -eq $ScaleUsers -and $metrics.findings -eq $ScaleUsers) 'Scale test lost users.'
        Assert-Test ($handler.Requests -eq (2 + [Math]::Ceiling($ScaleUsers / 500))) 'Scale test made N+1 requests or lost pagination.'
        $stream.Position = 0
        $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
        try {
            $reader = [System.IO.StreamReader]::new($zip.GetEntry('usuarios-inativos.csv').Open())
            $lines = -1
            try { while ($null -ne $reader.ReadLine()) { $lines++ } } finally { $reader.Dispose() }
            Assert-Test ($lines -eq $ScaleUsers) 'Scale CSV was truncated.'
            $scaleHtml = Read-ZipText $zip 'report.html'
            Assert-Test ($scaleHtml.Length -lt 100000 -and $scaleHtml.Contains('50')) 'HTML grew with the tenant instead of bounded samples.'
        } finally { $zip.Dispose() }
        [Console]::Error.WriteLine(('PASS: synthetic scale users={0}, requests={1}, archiveBytes={2}, elapsedSeconds={3:N1}, peakWorkingSetMiB={4:N1}; simulated network/pacing.' -f $ScaleUsers, $handler.Requests, $stream.Length, $watch.Elapsed.TotalSeconds, ([System.Diagnostics.Process]::GetCurrentProcess().PeakWorkingSet64 / 1MB)))
    } finally { Clear-TestStream $stream; $client.Dispose() }
}
# Exercise the actual stdin/binary-stdout wrapper. Test-only HttpClient injection
# is confined to a child session; the production wrapper/options are unchanged.
$wrapperCommand = @'
Add-Type -TypeDefinition @"
public sealed class InactiveWrapperHandler : System.Net.Http.HttpMessageHandler {
  protected override System.Threading.Tasks.Task<System.Net.Http.HttpResponseMessage> SendAsync(System.Net.Http.HttpRequestMessage request, System.Threading.CancellationToken token) {
    string json;
    if (request.RequestUri.AbsolutePath.EndsWith("/organization")) json = "{\"value\":[{\"id\":\"22222222-2222-4222-8222-222222222222\",\"displayName\":\"Synthetic wrapper tenant\"}]}";
    else if (request.RequestUri.AbsolutePath.EndsWith("/subscribedSkus")) json = "{\"value\":[]}";
    else json = "{\"value\":[{\"id\":\"00000000-0000-4000-8000-000000000001\",\"displayName\":\"Synthetic wrapper account\",\"userPrincipalName\":\"wrapper@example.invalid\",\"userType\":\"Member\",\"accountEnabled\":true,\"createdDateTime\":\"2020-01-01T00:00:00Z\",\"assignedLicenses\":[],\"signInActivity\":null}]}";
    var response = new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.OK);
    response.Content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");
    return System.Threading.Tasks.Task.FromResult(response);
  }
}
"@
$client = [System.Net.Http.HttpClient]::new([InactiveWrapperHandler]::new(), $true)
$PSDefaultParameterValues['Write-CloudOpsInactiveUsersArchive:HttpClient'] = $client
try { & '__WRAPPER_PATH__' } finally { $client.Dispose() }
'@
foreach ($context in @(
    '{}',
    (@{ executionId = 'EXE-550e8400-e29b-41d4-a716-446655440000'; assessmentId = 'inactive-users'; options = @{ days = 1 }; auth = @{ provider = 'microsoft-graph'; tenantId = $tenantId; accessToken = 'synthetic-wrapper-token' } } | ConvertTo-Json -Depth 5 -Compress),
    (@{ executionId = 'EXE-550e8400-e29b-41d4-a716-446655440000'; assessmentId = 'inactive-users'; options = @{}; auth = @{ provider = 'microsoft-graph'; tenantId = $tenantId; accessToken = 'synthetic-wrapper-token' } } | ConvertTo-Json -Depth 5 -Compress)
)) {
    $valid = $context.Contains('"options":{}')
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Join-Path $PSHOME $(if ($IsWindows) { 'pwsh.exe' } else { 'pwsh' }))
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $wrapperPath = Join-Path $engineRoot 'inactive-users/Invoke-Assessment.ps1'
    $arguments = if ($valid) { @('-NoLogo', '-NoProfile', '-NonInteractive', '-Command', $wrapperCommand.Replace('__WRAPPER_PATH__', $wrapperPath.Replace("'", "''"))) }
        else { @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $wrapperPath) }
    foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($start)
    $binaryOutput = [System.IO.MemoryStream]::new()
    try {
        $stdout = $process.StandardOutput.BaseStream.CopyToAsync($binaryOutput)
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($context)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(15000)) { $process.Kill($true); throw 'Wrapper validation timed out.' }
        $null = $stdout.GetAwaiter().GetResult()
        $control = $stderr.GetAwaiter().GetResult()
        Assert-Test (-not $control.Contains('synthetic-wrapper-token')) 'Wrapper leaked context.'
        if ($valid) {
            Assert-Test ($process.ExitCode -eq 0 -and $control.Contains('COMPLETED')) 'Valid wrapper execution did not complete.'
            $binaryOutput.Position = 0
            $wrapperZip = [System.IO.Compression.ZipArchive]::new($binaryOutput, [System.IO.Compression.ZipArchiveMode]::Read, $true)
            try {
                Assert-Test ($wrapperZip.Entries.Count -eq 2) 'Wrapper ZIP entry count failed.'
                $wrapperRows = @((Read-ZipText $wrapperZip 'usuarios-inativos.csv') | ConvertFrom-Csv -Delimiter ';')
                Assert-Test ($wrapperRows.Count -eq 1 -and $wrapperRows[0].UPN -ceq 'wrapper@example.invalid') 'Wrapper binary stdout or CSV failed.'
            } finally { $wrapperZip.Dispose() }
        } else {
            Assert-Test ($process.ExitCode -ne 0 -and $binaryOutput.Length -eq 0 -and $control.Contains('ASSESSMENT_FAILED')) 'Invalid wrapper context produced an artifact or missed safe failure.'
        }
    } finally { Clear-TestStream $binaryOutput; $process.Dispose() }
}
Assert-Test ((Get-TestFileSnapshot) -ceq $beforeFiles) 'Assessment validation changed engine or temporary files.'
if (-not $EmitPreview) { [Console]::WriteLine('PASS: inactivity boundaries, creation grace, pagination, licenses, safe HTML/CSV, offline charts, limits, stdin wrapper, file snapshots and partial-artifact cleanup.') }
