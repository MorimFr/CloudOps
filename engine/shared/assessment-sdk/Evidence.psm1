Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function New-CloudOpsEvidence {
    param([string] $Type, [object] $Facts)
    return Copy-CloudOpsSdkDto @{type=$Type;facts=$Facts} 'Evidence'
}
Export-ModuleMember -Function @('New-CloudOpsEvidence')
