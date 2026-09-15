Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function New-CloudOpsSdkRegistry {
    param([AllowEmptyCollection()] [object[]] $Definitions, [string] $Key = 'id')
    $map = [System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::Ordinal)
    foreach ($definition in $Definitions) { Assert-CloudOpsSdkCondition (-not $map.ContainsKey($definition[$Key])); $map.Add($definition[$Key],$definition) }
    return ,$map
}
function New-CloudOpsAssessmentPlan {
    [CmdletBinding()]
    param([object] $ControlPack, [object] $Definition, [object] $Context,
        [System.Collections.IDictionary] $CollectorRegistry, [System.Collections.IDictionary] $EvaluatorRegistry,
        [AllowEmptyCollection()] [string[]] $ManifestPermissions = @(), [AllowNull()] [object] $CollectorContext,
        [AllowNull()] [AllowEmptyCollection()] [string[]] $SelectedControlIds = $null)
    Assert-CloudOpsSdkDto $ControlPack 'ControlPack'; Assert-CloudOpsSdkDto $Definition 'Definition'; Assert-CloudOpsSdkDto $Context 'Context'
    Assert-CloudOpsSdkCondition ($Context.assessmentId -ceq $Definition.assessmentId -and $Context.assessmentVersion -ceq $Definition.assessmentVersion -and $Context.sdkVersion -ceq $Definition.sdkVersion)
    $collectors = New-CloudOpsSdkRegistry $Definition.collectors
    $evaluators = New-CloudOpsSdkRegistry $Definition.evaluators
    $recommendations = New-CloudOpsSdkRegistry $Definition.recommendations 'recommendationId'
    $allControlIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $allRequiredCollectors = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($collector in $Definition.collectors) {
        Assert-CloudOpsSdkCondition ($CollectorRegistry.Contains($collector.id) -and $CollectorRegistry[$collector.id] -is [scriptblock])
        foreach ($id in $collector.requiredCapabilities) { Assert-CloudOpsSdkCondition ($id -cin $Definition.capabilities) }
    }
    foreach ($evaluator in $Definition.evaluators) {
        Assert-CloudOpsSdkCondition ($EvaluatorRegistry.Contains($evaluator.id) -and $EvaluatorRegistry[$evaluator.id] -is [scriptblock])
        foreach ($id in $evaluator.collectorRequirements) { Assert-CloudOpsSdkCondition ($collectors.ContainsKey($id)) }
    }
    foreach ($id in $Definition.capabilities) { Assert-CloudOpsSdkCondition ($Context.capabilities.Contains($id)) }
    foreach ($control in $ControlPack.controls) {
        [void] $allControlIds.Add($control.id)
        Assert-CloudOpsSdkCondition ($recommendations.ContainsKey($control.recommendationId))
        foreach ($id in $control.collectorRequirements) {
            Assert-CloudOpsSdkCondition ($collectors.ContainsKey($id))
            if ($control.evaluationType -ceq 'AUTOMATED') { [void] $allRequiredCollectors.Add($id) }
        }
        if ($null -ne $control.evaluator) {
            Assert-CloudOpsSdkCondition ($evaluators.ContainsKey($control.evaluator))
            foreach ($id in $evaluators[$control.evaluator].collectorRequirements) { Assert-CloudOpsSdkCondition ($id -cin $control.collectorRequirements) }
        }
    }
    # Validate the complete pack, even when selection excludes a control. Only
    # referenced collectors count here; unused provider adapters may coexist.
    foreach ($id in $allRequiredCollectors) {
        $collector = $collectors[$id]
        foreach ($permission in $collector.requiredPermissions) { Assert-CloudOpsSdkCondition ($permission -cin $ManifestPermissions) }
        Assert-CloudOpsSdkCondition (-not $collector.requiresAuthentication -or $null -ne $CollectorContext)
    }
    if ($null -ne $SelectedControlIds) {
        Assert-CloudOpsSdkIds $SelectedControlIds 1000 -Control
        Assert-CloudOpsSdkCondition ($SelectedControlIds.Count -gt 0)
        foreach ($id in $SelectedControlIds) { Assert-CloudOpsSdkCondition ($allControlIds.Contains($id)) }
    }
    # Numeric order first; ordinal ID as a deterministic tie breaker, independent
    # of host locale. Sort once, not once per evaluator/collector.
    $orderedControls = [System.Collections.Generic.SortedDictionary[string,object]]::new([System.StringComparer]::Ordinal)
    foreach ($control in $ControlPack.controls) {
        if ($null -eq $SelectedControlIds -or $control.id -cin $SelectedControlIds) {
            $sortKey = ([long]$control.order).ToString('D5',[cultureinfo]::InvariantCulture) + ':' + $control.id
            $orderedControls.Add($sortKey,$control)
        }
    }
    $collectorIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $permissions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($control in $orderedControls.Values) {
        if ($control.evaluationType -cne 'AUTOMATED') { continue }
        foreach ($id in $control.collectorRequirements) {
            [void] $collectorIds.Add($id)
            foreach ($permission in $collectors[$id].requiredPermissions) { [void] $permissions.Add($permission) }
        }
    }
    return Copy-CloudOpsSdkDto ([ordered]@{schemaVersion='cloudops.assessment-plan.v1';packId=$ControlPack.id;controlPackVersion=$ControlPack.controlPackVersion;controlIds=@($orderedControls.Values | ForEach-Object { $_.id });collectorIds=(Get-CloudOpsSdkSortedIds @($collectorIds));requiredPermissions=(Get-CloudOpsSdkSortedIds @($permissions))}) 'Plan'
}
Export-ModuleMember -Function @('New-CloudOpsSdkRegistry','New-CloudOpsAssessmentPlan')
