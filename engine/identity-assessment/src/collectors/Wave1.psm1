Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../../../shared/CloudOps.Graph.psm1') -DisableNameChecking

function Get-IdentityProperty {
    param([AllowNull()] [object] $Object, [string] $Name)
    if ($Object -is [System.Collections.IDictionary]) { return ,$Object[$Name] }
    if ($null -ne $Object -and $Object -is [pscustomobject]) {
        $property = $Object.PSObject.Properties[$Name]
        if ($null -ne $property) { return ,$property.Value }
    }
    return $null
}
function Get-IdentityBoolean {
    param([AllowNull()] [object] $Value)
    if ($Value -is [bool]) { return $Value }
    return $null
}
function Test-IdentityGroupSettingsQuery {
    param([uri] $Uri)
    # Paging tokens are opaque. Other query options cannot change the collection
    # or omit facts needed to conclude that Directory.Unified is absent.
    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($part in $Uri.Query.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries)) {
        $pair = $part.Split('=', 2)
        if ($pair.Count -ne 2) { return $false }
        $key = [uri]::UnescapeDataString($pair[0])
        $value = [uri]::UnescapeDataString($pair[1])
        if (-not $keys.Add($key)) { return $false }
        switch -CaseSensitive ($key) {
            '$skiptoken' { if ($value.Length -eq 0) { return $false } }
            '$skip' { if ($value -cnotmatch '^\d+$') { return $false } }
            '$top' { if ($value -cnotmatch '^[1-9]\d*$') { return $false } }
            '$select' { if ($value -cnotin @('templateId,values','values,templateId')) { return $false } }
            default { return $false }
        }
    }
    return $true
}
function ConvertTo-IdentityPolicyFacts {
    param([ValidateSet('authorization-policy','device-registration-policy','admin-consent-policy')] [string] $CollectorId, [object] $Raw)
    # A field missing from a successful object is unknown, not a default value.
    switch ($CollectorId) {
        'authorization-policy' {
            $role = Get-IdentityProperty $Raw 'defaultUserRolePermissions'
            $facts = @{}
            foreach ($name in @('allowedToCreateApps','allowedToCreateTenants','allowedToCreateSecurityGroups','allowedToReadBitlockerKeysForOwnedDevice')) {
                $facts[$name] = Get-IdentityBoolean (Get-IdentityProperty $role $name)
            }
            # These are Microsoft product role templates, never tenant object IDs.
            $guestRole = Get-IdentityProperty $Raw 'guestUserRoleId'
            if ($guestRole -is [string]) { $guestRole = $guestRole.ToLowerInvariant() }
            $facts.guestRoleCategory = switch -CaseSensitive ($guestRole) {
                '10dae51f-b6af-4016-8d66-8c2a99b929b3' { 1 }
                '2af84b1e-32c8-42b7-82bc-daa82404023b' { 2 }
                'a0b1b346-4d3e-4e8b-98f8-753987be4970' { 3 }
                default { $null }
            }
            $facts.invitationPolicyCategory = switch -CaseSensitive (Get-IdentityProperty $Raw 'allowInvitesFrom') {
                'adminsAndGuestInviters' { 1 }
                'none' { 2 }
                'adminsGuestInvitersAndAllMembers' { 3 }
                'everyone' { 4 }
                default { $null }
            }
            return $facts
        }
        'device-registration-policy' {
            $quota = Get-IdentityProperty $Raw 'userDeviceQuota'
            if ($quota -isnot [int] -and $quota -isnot [long]) { $quota = $null }
            if ($null -ne $quota -and ($quota -lt 0 -or $quota -gt 9007199254740991)) { $quota = $null }
            return @{ userDeviceQuota = $quota; lapsEnabled = Get-IdentityBoolean (Get-IdentityProperty (Get-IdentityProperty $Raw 'localAdminPassword') 'isEnabled') }
        }
        'admin-consent-policy' { return @{ adminConsentRequestsEnabled = Get-IdentityBoolean (Get-IdentityProperty $Raw 'isEnabled') } }
    }
}

function Invoke-IdentityWave1Collector {
    [CmdletBinding()]
    param(
        [ValidateSet('authorization-policy','group-settings','device-registration-policy','admin-consent-policy')] [string] $CollectorId,
        [Parameter(Mandatory)] [string] $AccessToken,
        [System.Net.Http.HttpClient] $HttpClient,
        [ValidateRange(1,100)] [int] $MaximumPages = 100,
        [ValidateRange(1,5)] [int] $MaximumAttempts = 3,
        [scriptblock] $DelayAction = { param($Milliseconds) if ($Milliseconds -gt 0) { Start-Sleep -Milliseconds $Milliseconds } }
    )
    $paths = @{
        'authorization-policy' = '/policies/authorizationPolicy?$select=defaultUserRolePermissions,guestUserRoleId,allowInvitesFrom'
        'device-registration-policy' = '/policies/deviceRegistrationPolicy?$select=userDeviceQuota,localAdminPassword'
        'admin-consent-policy' = '/policies/adminConsentRequestPolicy?$select=isEnabled'
        'group-settings' = '/groupSettings?$select=templateId,values'
    }
    $status = 'SUCCESS'; $warnings = @(); $facts = @{}; $completed = 0; $raw = $null
    $parameters = @{ AccessToken=$AccessToken; HttpClient=$HttpClient; MaximumAttempts=$MaximumAttempts; DelayAction=$DelayAction; Method='GET' }
    try {
        if ($CollectorId -cne 'group-settings') {
            $raw = Invoke-CloudOpsGraphRequest @parameters -Path $paths[$CollectorId]
            $completed = 1
            $facts = ConvertTo-IdentityPolicyFacts -CollectorId $CollectorId -Raw $raw
        } else {
            # Follow only the same collection. Do not trust a nextLink's route,
            # version, host, userinfo, or query projection. No per-group reads.
            $nextUri = [uri]('https://graph.microsoft.com/v1.0' + $paths[$CollectorId])
            $visited = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            $templates = 0; $keys = 0; $enabled = $null; $ambiguous = $false; $complete = $false
            for ($page = 0; $page -lt $MaximumPages; $page++) {
                if (-not $visited.Add($nextUri.AbsoluteUri)) { break }
                $raw = Invoke-CloudOpsGraphRequest @parameters -Uri $nextUri
                $values = Get-IdentityProperty $raw 'value'
                if ($values -isnot [array]) { throw [System.ArgumentException]::new('Invalid settings page.') }
                foreach ($setting in $values) {
                    $template = Get-IdentityProperty $setting 'templateId'
                    $templateGuid = [guid]::Empty
                    if ($template -isnot [string] -or -not [guid]::TryParse($template,[ref]$templateGuid) -or $templateGuid -eq [guid]::Empty) { $ambiguous = $true; continue }
                    if ($templateGuid.ToString() -cne '62375ab9-6b52-47ed-826b-58e47e0e304b') { continue }
                    $templates++
                    $settings = Get-IdentityProperty $setting 'values'
                    if ($settings -isnot [array]) { $ambiguous = $true; continue }
                    foreach ($item in $settings) {
                        if ((Get-IdentityProperty $item 'name') -cne 'EnableGroupCreation') { continue }
                        $keys++
                        $value = Get-IdentityProperty $item 'value'
                        # The Graph settingValue type is a string, not Boolean.
                        if ($value -is [string] -and $value -in @('true','false')) { $enabled = $value -ieq 'true' }
                        else { $ambiguous = $true }
                    }
                }
                $completed++
                $link = Get-IdentityProperty $raw '@odata.nextLink'
                $raw = $null
                if ($null -eq $link) { $complete = $true; break }
                $candidate = $null
                if ($link -isnot [string] -or -not [uri]::TryCreate($link,[UriKind]::Absolute,[ref]$candidate) -or
                    $candidate.Scheme -cne 'https' -or $candidate.Host -cne 'graph.microsoft.com' -or $candidate.Port -ne 443 -or
                    $candidate.UserInfo.Length -ne 0 -or $candidate.Fragment.Length -ne 0 -or $candidate.AbsolutePath -cne '/v1.0/groupSettings' -or
                    -not (Test-IdentityGroupSettingsQuery $candidate)) { break }
                $nextUri = $candidate
            }
            $facts = @{ groupUnifiedTemplateCount=$templates; enableGroupCreation=$enabled; groupSettingKeyCount=$keys; groupSettingsComplete=$complete }
            if (-not $complete -or $ambiguous -or $templates -gt 1 -or ($templates -eq 1 -and $keys -ne 1)) {
                $status = 'PARTIAL'; $warnings = @('GROUP_SETTINGS_INCOMPLETE')
            }
        }
    } catch {
        # Expected access denial is insufficient coverage, never a violation.
        $code = $_.Exception.Data['CloudOpsCode']
        if ($code -cin @('GRAPH_INSUFFICIENT_PRIVILEGES','GRAPH_AUTHENTICATION_FAILED','GRAPH_CONSENT_REQUIRED')) {
            $status = 'PARTIAL'; $warnings = @('POLICY_ACCESS_UNAVAILABLE')
        } else { $status = 'FAILED'; $warnings = @('POLICY_COLLECTION_FAILED') }
        $facts = @{}
    } finally { $raw=$null; $AccessToken=$null; $parameters.Clear() }
    return @{schemaVersion='cloudops.collector-result.v1';collectorId=$CollectorId;status=$status;requestCount=$completed;data=$facts;warnings=$warnings}
}

function Get-IdentityWave1CollectorRegistry {
    return @{
        'authorization-policy' = { param($CollectorContext,$Context) Invoke-IdentityWave1Collector -CollectorId 'authorization-policy' @CollectorContext }
        'group-settings' = { param($CollectorContext,$Context) Invoke-IdentityWave1Collector -CollectorId 'group-settings' @CollectorContext }
        'device-registration-policy' = { param($CollectorContext,$Context) Invoke-IdentityWave1Collector -CollectorId 'device-registration-policy' @CollectorContext }
        'admin-consent-policy' = { param($CollectorContext,$Context) Invoke-IdentityWave1Collector -CollectorId 'admin-consent-policy' @CollectorContext }
    }
}
Export-ModuleMember -Function Invoke-IdentityWave1Collector, Get-IdentityWave1CollectorRegistry, ConvertTo-IdentityPolicyFacts
