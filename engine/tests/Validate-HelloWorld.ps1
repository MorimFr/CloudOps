#requires -Version 7.2

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Condition {
    param(
        [Parameter(Mandatory)]
        [bool] $Condition,

        [Parameter(Mandatory)]
        [string] $Message
    )

    if (-not $Condition) {
        throw [System.InvalidOperationException]::new($Message)
    }
}

function Get-CloudOpsFileSnapshot {
    param(
        [Parameter(Mandatory)]
        [string[]] $Roots
    )

    $snapshot = @(
        foreach ($root in $Roots) {
            if (-not (Test-Path -LiteralPath $root -PathType Container)) {
                continue
            }

            $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
            $pendingDirectories.Push($root)
            while ($pendingDirectories.Count -gt 0) {
                $currentDirectory = $pendingDirectories.Pop()
                foreach ($file in Get-ChildItem -LiteralPath $currentDirectory -File -Force -ErrorAction Stop) {
                    if (
                        $IsLinux -and
                        $file.FullName -eq (Join-Path $HOME '.cache/powershell/StartupProfileData-NonInteractive')
                    ) {
                        # pwsh rewrites this non-assessment startup timing cache
                        # on every process launch, including -NoProfile sessions.
                        continue
                    }
                    if ($IsLinux -and -not ([string] $file.UnixMode).StartsWith('-')) {
                        # PowerShell exposes Unix sockets and named pipes as FileInfo;
                        # reading those endpoints would block and they are not storage.
                        continue
                    }
                    $hash = [System.Security.Cryptography.SHA256]::HashData(
                        [System.IO.File]::ReadAllBytes($file.FullName)
                    )
                    '{0}|{1}|{2}' -f $file.FullName, $file.Length, [Convert]::ToHexString($hash)
                }

                foreach ($directory in Get-ChildItem -LiteralPath $currentDirectory -Directory -Force -ErrorAction Stop) {
                    if (
                        $directory.Name -in @('node_modules', '.git') -or
                        ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
                    ) {
                        continue
                    }
                    $pendingDirectories.Push($directory.FullName)
                }
            }
        }
    )
    return $snapshot | Sort-Object
}

$engineRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $engineRoot
$assessmentScript = Join-Path $engineRoot 'hello-world/Invoke-Assessment.ps1'
$inspectionRoots = @($projectRoot)
if ($IsLinux -and (Test-Path -LiteralPath '/tmp' -PathType Container)) {
    $inspectionRoots += '/tmp'
}
$filesBefore = Get-CloudOpsFileSnapshot -Roots $inspectionRoots

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = (Get-Command pwsh -ErrorAction Stop).Source
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment['POWERSHELL_TELEMETRY_OPTOUT'] = '1'
$startInfo.Environment['POWERSHELL_UPDATECHECK'] = 'Off'
$startInfo.Environment['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'
if ($IsLinux) {
    $startInfo.Environment['PSModuleAnalysisCachePath'] = '/dev/null'
}
[void] $startInfo.ArgumentList.Add('-NoLogo')
[void] $startInfo.ArgumentList.Add('-NoProfile')
[void] $startInfo.ArgumentList.Add('-NonInteractive')
[void] $startInfo.ArgumentList.Add('-File')
[void] $startInfo.ArgumentList.Add($assessmentScript)

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$artifactStream = [System.IO.MemoryStream]::new()
$archive = $null

try {
    Assert-Condition -Condition ($process.Start()) -Message 'Could not start the PowerShell child process.'

    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($artifactStream)
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $context = [ordered]@{
        executionId = 'EXE-550e8400-e29b-41d4-a716-446655440000'
        assessmentId = 'hello-world'
        options = @{}
    } | ConvertTo-Json -Compress
    $process.StandardInput.Write($context)
    $process.StandardInput.Close()

    $process.WaitForExit()
    [void] $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    Assert-Condition -Condition ($process.ExitCode -eq 0) -Message "Assessment exited with code $($process.ExitCode)."
    Assert-Condition -Condition ($artifactStream.Length -gt 0) -Message 'Assessment returned an empty artifact.'

    $events = @(
        $stderr -split '\r?\n' |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object { $_ | ConvertFrom-Json -Depth 16 -ErrorAction Stop }
    )
    Assert-Condition -Condition ($events.Count -eq 5) -Message 'Expected four progress events and one summary event.'

    $progressEvents = @($events | Where-Object type -eq 'progress')
    Assert-Condition -Condition ($progressEvents.Count -eq 4) -Message 'Expected four progress events.'
    Assert-Condition -Condition (($progressEvents.stage -join ',') -eq 'INITIALIZING,PROCESSING,GENERATING_REPORT,COMPLETED') -Message 'Progress stages were not emitted in contract order.'
    Assert-Condition -Condition (($progressEvents.progress -join ',') -eq '10,55,85,100') -Message 'Progress values were not emitted in contract order.'
    Assert-Condition -Condition (@($events | Where-Object type -eq 'summary').Count -eq 1) -Message 'Expected one summary event.'

    $artifactStream.Position = 0
    $archive = [System.IO.Compression.ZipArchive]::new(
        $artifactStream,
        [System.IO.Compression.ZipArchiveMode]::Read,
        $true
    )
    $entryNames = @($archive.Entries | ForEach-Object FullName | Sort-Object)
    Assert-Condition -Condition (($entryNames -join ',') -eq 'report.html,summary.json') -Message 'ZIP entries do not match the contract.'

    $reportEntry = $archive.GetEntry('report.html')
    $reader = [System.IO.StreamReader]::new($reportEntry.Open())
    try {
        $report = $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
    Assert-Condition -Condition ($report.Contains('Assessment completed successfully.')) -Message 'Report content is invalid.'

    $summaryEntry = $archive.GetEntry('summary.json')
    $reader = [System.IO.StreamReader]::new($summaryEntry.Open())
    try {
        $summary = $reader.ReadToEnd() | ConvertFrom-Json -Depth 8 -ErrorAction Stop
    }
    finally {
        $reader.Dispose()
    }
    Assert-Condition -Condition ($summary.assessmentId -eq 'hello-world') -Message 'Summary content is invalid.'

    $archive.Dispose()
    $archive = $null

    $filesAfter = Get-CloudOpsFileSnapshot -Roots $inspectionRoots
    Assert-Condition -Condition (($filesBefore -join "`n") -ceq ($filesAfter -join "`n")) -Message 'Assessment changed the project or runtime temporary filesystem.'

    [Console]::WriteLine('PASS: context, NDJSON events, in-memory ZIP, entries, content, and zero assessment-file writes in project and /tmp validated.')
}
finally {
    if ($null -ne $archive) {
        $archive.Dispose()
    }
    if ($artifactStream.Length -gt 0) {
        $buffer = $artifactStream.GetBuffer()
        [Array]::Clear($buffer, 0, $buffer.Length)
    }
    $artifactStream.Dispose()
    $process.Dispose()
}
