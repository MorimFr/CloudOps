#requires -Version 7.2
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot '../shared/CloudOps.Execution.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../shared/CloudOps.Security.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'CloudOps.InactiveUsers.psm1') -DisableNameChecking

$context = $null
$archiveStream = [System.IO.MemoryStream]::new()
$artifactBuffer = $null
$parameters = $null
try {
    $context = Read-CloudOpsExecutionContext
    if ($context.assessmentId -cne 'inactive-users' -or $context.auth.provider -cne 'microsoft-graph' -or
        $null -eq $context.options -or @($context.options.PSObject.Properties).Count -ne 0) {
        throw [System.ArgumentException]::new('Invalid assessment context.')
    }
    $parameters = @{
        AccessToken = [string] $context.auth.accessToken
        TenantId = [string] $context.auth.tenantId
        ExecutionId = [string] $context.executionId
        ArchiveStream = $archiveStream
    }
    $metrics = Write-CloudOpsInactiveUsersArchive @parameters
    $parameters = $null
    $context.auth.accessToken = $null
    $artifactBuffer = $archiveStream.GetBuffer()
    Write-CloudOpsPublicMetrics -PublicMetrics $metrics
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    Write-CloudOpsArtifact -Bytes $artifactBuffer -Count ([int] $archiveStream.Length)
}
catch {
    $code = [string] $_.Exception.Data['CloudOpsCode']
    if ($code -cnotin @('GRAPH_CONSENT_REQUIRED', 'GRAPH_AUTHENTICATION_FAILED', 'GRAPH_INSUFFICIENT_PRIVILEGES', 'GRAPH_THROTTLED', 'GRAPH_UNAVAILABLE')) { $code = 'ASSESSMENT_FAILED' }
    Write-CloudOpsFailure -Code $code
    exit 1
}
finally {
    $parameters = $null
    if ($null -ne $context -and $null -ne $context.PSObject.Properties['auth'] -and $null -ne $context.auth -and $null -ne $context.auth.PSObject.Properties['accessToken']) { $context.auth.accessToken = $null }
    $context = $null
    $artifactBuffer = $archiveStream.GetBuffer()
    [Array]::Clear($artifactBuffer, 0, $artifactBuffer.Length)
    $archiveStream.Dispose()
}
