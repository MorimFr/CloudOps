Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function Invoke-CloudOpsCollectors {
    param([object] $Plan, [System.Collections.IDictionary] $CollectorRegistry, [object] $Context, [AllowNull()] [object] $CollectorContext)
    Assert-CloudOpsSdkDto $Context 'Context'; Assert-CloudOpsSdkDto $Plan 'Plan'
    Assert-CloudOpsSdkIds $Plan.collectorIds 100
    $results = [System.Collections.Generic.List[object]]::new()
    try {
        foreach ($id in $Plan.collectorIds) {
            Assert-CloudOpsSdkCondition ($CollectorRegistry.Contains($id) -and $CollectorRegistry[$id] -is [scriptblock])
            $result = $null
            try {
                # The provider boundary receives the auth object only here.
                # Collector output must already be normalized aggregate facts.
                $result = & $CollectorRegistry[$id] $CollectorContext (Copy-CloudOpsSdkDto $Context 'Context')
                Assert-CloudOpsSdkDto $result 'CollectorResult'
                Assert-CloudOpsSdkCondition ($result.collectorId -ceq $id)
                $result = Copy-CloudOpsSdkDto $result 'CollectorResult'
            } catch {
                $result = [ordered]@{schemaVersion='cloudops.collector-result.v1';collectorId=$id;status='FAILED';requestCount=0;data=@{};warnings=@('COLLECTOR_FAILED')}
            }
            $results.Add($result)
            $result = $null
        }
        return ,$results.ToArray()
    } finally { $CollectorContext = $null; $results.Clear() }
}
Export-ModuleMember -Function @('Invoke-CloudOpsCollectors')
