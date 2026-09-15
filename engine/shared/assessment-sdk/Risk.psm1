Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function Get-CloudOpsRisk {
    param([string] $BaseSeverity, [object] $Signals)
    $levels = @('LOW','MEDIUM','HIGH','CRITICAL')
    Assert-CloudOpsSdkEnum $BaseSeverity $levels; Assert-CloudOpsSdkDto $Signals 'Signals'
    $increments = [int]$Signals.exposed + [int]$Signals.privileged
    if ($Signals.compensatingControl -and $increments -gt 0) { $increments-- }
    $rank = [Math]::Min(3, [Array]::IndexOf($levels,$BaseSeverity) + $increments)
    return Copy-CloudOpsSdkDto @{modelVersion='cloudops.risk.v1';baseSeverity=$BaseSeverity;severity=$levels[$rank];signals=$Signals} 'Risk'
}
Export-ModuleMember -Function @('Get-CloudOpsRisk')
