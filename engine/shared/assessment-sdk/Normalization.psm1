Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function New-CloudOpsNormalizedState {
    param([AllowEmptyCollection()] [object[]] $CollectorResults, [object] $Context)
    Assert-CloudOpsSdkDto $Context 'Context'
    $datasets = [ordered]@{}
    foreach ($result in $CollectorResults) {
        Assert-CloudOpsSdkDto $result 'CollectorResult'
        Assert-CloudOpsSdkCondition (-not $datasets.Contains($result.collectorId))
        $datasets[$result.collectorId] = @{status=$result.status;facts=$result.data}
    }
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.normalized-state.v1';assessmentTimestamp=$Context.assessmentTimestamp;datasets=$datasets;capabilities=$Context.capabilities} 'NormalizedState'
}
Export-ModuleMember -Function @('New-CloudOpsNormalizedState')
