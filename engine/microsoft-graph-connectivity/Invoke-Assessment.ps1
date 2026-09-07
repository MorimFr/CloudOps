#requires -Version 7.2

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

$sharedDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'shared'
Import-Module (Join-Path $sharedDirectory 'CloudOps.Execution.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $sharedDirectory 'CloudOps.Security.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $sharedDirectory 'CloudOps.Graph.psm1') -Force -DisableNameChecking

$archiveStream = $null
$artifactBuffer = $null
$reportBytes = $null
$summaryBytes = $null
$accessToken = $null
$context = $null
$graphParameters = $null
$me = $null
$reportHtml = $null
$summary = $null

try {
    $context = Read-CloudOpsExecutionContext
    if (
        $null -eq $context.executionId -or
        $null -eq $context.assessmentId -or
        $null -eq $context.auth
    ) {
        throw [System.ArgumentException]::new('Required context fields are missing.')
    }

    $executionId = Assert-CloudOpsIdentifier -Value ([string] $context.executionId) -Name 'executionId'
    $assessmentId = Assert-CloudOpsIdentifier -Value ([string] $context.assessmentId) -Name 'assessmentId'
    if ($assessmentId -cne 'microsoft-graph-connectivity') {
        throw [System.ArgumentException]::new('Assessment context does not match this engine.')
    }
    if ([string] $context.auth.provider -cne 'microsoft-graph') {
        throw [System.ArgumentException]::new('The required authentication provider is missing.')
    }

    $tenantId = Assert-CloudOpsTenantId -Value ([string] $context.auth.tenantId)
    $accessToken = Assert-CloudOpsTransientAccessToken -Value ([string] $context.auth.accessToken)

    Write-CloudOpsProgress -Stage 'INITIALIZING' -Progress 10
    Write-CloudOpsProgress -Stage 'AUTHENTICATING' -Progress 25
    Write-CloudOpsProgress -Stage 'QUERYING_GRAPH' -Progress 55

    $graphParameters = @{
        AccessToken = $accessToken
        Path = '/me?$select=id,displayName,userPrincipalName'
    }
    $me = Invoke-CloudOpsGraphRequest @graphParameters

    $graphParameters = $null
    $accessToken = $null
    $context.auth.accessToken = $null

    $principalId = [string] $me.id
    $displayName = [string] $me.displayName
    $userPrincipalName = [string] $me.userPrincipalName
    if ([string]::IsNullOrWhiteSpace($principalId)) {
        throw [System.InvalidOperationException]::new('Microsoft Graph returned an invalid principal.')
    }

    $safeExecutionId = ConvertTo-CloudOpsHtmlText -Value $executionId
    $safeTenantId = ConvertTo-CloudOpsHtmlText -Value $tenantId
    $safePrincipalId = ConvertTo-CloudOpsHtmlText -Value $principalId
    $safeDisplayName = ConvertTo-CloudOpsHtmlText -Value $displayName
    $safeUserPrincipalName = ConvertTo-CloudOpsHtmlText -Value $userPrincipalName

    $reportHtml = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CloudOps - Microsoft Graph Connectivity</title>
</head>
<body>
  <main>
    <h1>Microsoft Graph Connectivity</h1>
    <p>Status: <strong>Connected</strong></p>
    <p>Execution ID: <code>$safeExecutionId</code></p>
    <p>Tenant: <code>$safeTenantId</code></p>
    <h2>Signed-in principal</h2>
    <dl>
      <dt>ID</dt><dd><code>$safePrincipalId</code></dd>
      <dt>Display name</dt><dd>$safeDisplayName</dd>
      <dt>User principal name</dt><dd>$safeUserPrincipalName</dd>
      <dt>Authentication</dt><dd>Delegated</dd>
      <dt>Required permission</dt><dd>User.Read</dd>
    </dl>
  </main>
</body>
</html>
"@

    $summary = [ordered]@{
        assessmentId       = 'microsoft-graph-connectivity'
        status             = 'connected'
        tenantId           = $tenantId
        authentication     = 'delegated'
        requiredPermission = 'User.Read'
        principal          = [ordered]@{
            id                = $principalId
            displayName       = $displayName
            userPrincipalName = $userPrincipalName
        }
    }

    Write-CloudOpsProgress -Stage 'GENERATING_REPORT' -Progress 85
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $reportBytes = $utf8.GetBytes($reportHtml)
    $summaryBytes = $utf8.GetBytes(($summary | ConvertTo-Json -Depth 8))
    $archiveStream = [System.IO.MemoryStream]::new()
    $archive = [System.IO.Compression.ZipArchive]::new(
        $archiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $true,
        $utf8
    )

    try {
        $reportEntry = $archive.CreateEntry('report.html', [System.IO.Compression.CompressionLevel]::Optimal)
        $reportEntryStream = $reportEntry.Open()
        try {
            $reportEntryStream.Write($reportBytes, 0, $reportBytes.Length)
        }
        finally {
            $reportEntryStream.Dispose()
        }

        $summaryEntry = $archive.CreateEntry('summary.json', [System.IO.Compression.CompressionLevel]::Optimal)
        $summaryEntryStream = $summaryEntry.Open()
        try {
            $summaryEntryStream.Write($summaryBytes, 0, $summaryBytes.Length)
        }
        finally {
            $summaryEntryStream.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }

    $artifactBuffer = $archiveStream.GetBuffer()
    $artifactLength = [int] $archiveStream.Length
    Write-CloudOpsPublicMetrics -PublicMetrics ([ordered]@{
        graphReachable    = $true
        requestsCompleted = 1
    })
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    Write-CloudOpsArtifact -Bytes $artifactBuffer -Count $artifactLength
}
catch {
    $failureCode = 'ASSESSMENT_FAILED'
    if (
        $null -ne $_.Exception -and
        $null -ne $_.Exception.Data -and
        $_.Exception.Data.Contains('CloudOpsCode')
    ) {
        $candidate = [string] $_.Exception.Data['CloudOpsCode']
        if ($candidate -cin @(
            'GRAPH_CONSENT_REQUIRED',
            'GRAPH_AUTHENTICATION_FAILED',
            'GRAPH_INSUFFICIENT_PRIVILEGES',
            'GRAPH_THROTTLED',
            'GRAPH_UNAVAILABLE'
        )) {
            $failureCode = $candidate
        }
    }
    Write-CloudOpsFailure -Code $failureCode
    exit 1
}
finally {
    $accessToken = $null
    if (
        $null -ne $context -and
        $null -ne $context.PSObject.Properties['auth'] -and
        $null -ne $context.auth -and
        $null -ne $context.auth.PSObject.Properties['accessToken']
    ) {
        $context.auth.accessToken = $null
    }
    $graphParameters = $null
    $accessToken = $null
    $me = $null
    $reportHtml = $null
    $summary = $null
    $principalId = $null
    $displayName = $null
    $userPrincipalName = $null
    $safeTenantId = $null
    $safePrincipalId = $null
    $safeDisplayName = $null
    $safeUserPrincipalName = $null
    $context = $null
    if ($null -ne $artifactBuffer) {
        [Array]::Clear($artifactBuffer, 0, $artifactBuffer.Length)
    }
    if ($null -ne $reportBytes) {
        [Array]::Clear($reportBytes, 0, $reportBytes.Length)
    }
    if ($null -ne $summaryBytes) {
        [Array]::Clear($summaryBytes, 0, $summaryBytes.Length)
    }
    if ($null -ne $archiveStream) {
        try {
            $internalBuffer = $archiveStream.GetBuffer()
            [Array]::Clear($internalBuffer, 0, $internalBuffer.Length)
        }
        catch {
            # Best-effort cleanup only; managed strings and copies cannot be wiped reliably.
        }
        $archiveStream.Dispose()
    }
}
