#requires -Version 7.2
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$sharedDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'shared'
Import-Module (Join-Path $sharedDirectory 'CloudOps.Execution.psm1') -DisableNameChecking
Import-Module (Join-Path $sharedDirectory 'CloudOps.Security.psm1') -DisableNameChecking

$context = $null
try {
    $context = Read-CloudOpsExecutionContext
    $null = Assert-CloudOpsIdentifier -Value ([string] $context.executionId) -Name 'executionId'
    if ($context.assessmentId -cne 'identity-assessment') { throw [System.ArgumentException]::new('Invalid assessment context.') }
    # Defense in depth: the public manifest is disabled. A production entrypoint
    # must never impersonate a real tenant assessment using bundled fixtures.
    # The separate local test harness invokes the same plugin/SDK pipeline with
    # explicitly synthetic state; no API option can activate that harness.
    throw [System.InvalidOperationException]::new('An authorized production control pack is not available.')
} catch {
    Write-CloudOpsFailure -Code 'ASSESSMENT_FAILED'
    exit 1
} finally { $context = $null }
