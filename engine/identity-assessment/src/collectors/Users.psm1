Set-StrictMode -Version Latest

$sharedDirectory = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'shared'
Import-Module (Join-Path $sharedDirectory 'CloudOps.Graph.psm1') -DisableNameChecking
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'normalization/IdentityState.psm1') -DisableNameChecking

function Invoke-IdentityUsersCollector {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $AccessToken,
        [System.Net.Http.HttpClient] $HttpClient,
        [ValidateRange(1, 10000)] [int] $MaximumPages = 1000,
        [ValidateRange(1, 5)] [int] $MaximumAttempts = 3,
        [scriptblock] $DelayAction = { param([int] $Milliseconds) if ($Milliseconds -gt 0) { Start-Sleep -Milliseconds $Milliseconds } }
    )

    $aggregate = New-IdentityUserAggregate
    $progress = @{ completedPages = 0 }
    $status = 'SUCCESS'
    $warnings = [System.Collections.Generic.List[string]]::new()
    try {
        $parameters = @{
            AccessToken = $AccessToken
            Path = '/users?$select=userType,accountEnabled,externalUserState&$top=999'
            HttpClient = $HttpClient
            MaximumPages = $MaximumPages
            MaximumAttempts = $MaximumAttempts
            DelayAction = $DelayAction
            PageCompletedAction = { param([int] $PageNumber) $progress.completedPages = $PageNumber }
        }
        # Do not materialize @(...). At most the shared client's current page
        # and these fixed-size counters are retained, regardless of tenant size.
        Get-CloudOpsGraphCollection @parameters | ForEach-Object {
            try { Add-IdentityUserObservation -Aggregate $aggregate -RawUser $_ }
            finally { $_ = $null }
        }
        if ($aggregate.missingProperties -gt 0 -or $aggregate.unexpectedValues -gt 0) {
            $status = 'PARTIAL'
            $warnings.Add('INCOMPLETE_USER_PROPERTIES')
        }
    } catch {
        $status = if ($aggregate.total -gt 0) { 'PARTIAL' } else { 'FAILED' }
        # Never forward error bodies, request URIs, headers, or tokens.
        $warnings.Add('USER_COLLECTION_FAILED')
    } finally {
        $AccessToken = $null
        if ($null -ne (Get-Variable -Name parameters -ErrorAction SilentlyContinue)) { $parameters.Clear() }
    }
    return @{
        schemaVersion = 'cloudops.collector-result.v1'
        collectorId = 'identity-users-summary'
        status = $status
        # Completed logical page requests, not wire attempts (which may retry).
        requestCount = $progress.completedPages
        data = $aggregate
        warnings = @($warnings.ToArray())
    }
}

Export-ModuleMember -Function Invoke-IdentityUsersCollector
