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

$archiveStream = $null
$artifactBytes = $null
$reportBytes = $null
$summaryBytes = $null

try {
    $context = Read-CloudOpsExecutionContext

    if ($null -eq $context.executionId -or $null -eq $context.assessmentId) {
        throw [System.ArgumentException]::new('Required context fields are missing.')
    }

    $executionId = Assert-CloudOpsIdentifier -Value ([string] $context.executionId) -Name 'executionId'
    $assessmentId = Assert-CloudOpsIdentifier -Value ([string] $context.assessmentId) -Name 'assessmentId'

    if ($assessmentId -cne 'hello-world') {
        throw [System.ArgumentException]::new('Assessment context does not match this engine.')
    }

    Write-CloudOpsProgress -Stage 'INITIALIZING' -Progress 10
    Start-Sleep -Milliseconds 250
    Write-CloudOpsProgress -Stage 'PROCESSING' -Progress 55
    Start-Sleep -Milliseconds 250

    $safeExecutionId = ConvertTo-CloudOpsHtmlText -Value $executionId
    $reportHtml = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CloudOps - Hello World Assessment</title>
</head>
<body>
  <main>
    <h1>CloudOps</h1>
    <h2>Hello World Assessment</h2>
    <p>Execution ID: <code>$safeExecutionId</code></p>
    <p>Assessment completed successfully.</p>
  </main>
</body>
</html>
"@

    $summary = [ordered]@{
        assessmentId = 'hello-world'
        result       = 'success'
        message      = 'Assessment completed successfully.'
        findings     = 0
    }

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $reportBytes = $utf8.GetBytes($reportHtml)
    $summaryBytes = $utf8.GetBytes(($summary | ConvertTo-Json -Depth 8))

    Write-CloudOpsProgress -Stage 'GENERATING_REPORT' -Progress 85
    Start-Sleep -Milliseconds 250

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

    $artifactBytes = $archiveStream.ToArray()

    Write-CloudOpsSummary -Summary ([ordered]@{
        message = 'Assessment completed successfully.'
        findings = 0
    })
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    Write-CloudOpsArtifact -Bytes $artifactBytes
}
catch {
    Write-CloudOpsFailure -Code 'ASSESSMENT_FAILED' -Message 'The assessment could not be completed.'
    exit 1
}
finally {
    if ($null -ne $artifactBytes) {
        [Array]::Clear($artifactBytes, 0, $artifactBytes.Length)
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
            # MemoryStream created above is exposable; this is defensive best effort only.
        }
        $archiveStream.Dispose()
    }
}
