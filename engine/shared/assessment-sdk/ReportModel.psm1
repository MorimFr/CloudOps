Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function New-CloudOpsAssessmentReportModel {
    param([object] $AssessmentResult, [AllowEmptyCollection()] [object[]] $Recommendations, [object] $AiEnrichment, [AllowEmptyCollection()] [string[]] $Limitations=@())
    Assert-CloudOpsSdkDto $AssessmentResult 'AssessmentResult'; Assert-CloudOpsSdkDto $AiEnrichment 'AiEnrichment'
    $summary=@{criticalFindings=0;highFindings=0;mediumFindings=0;lowFindings=0}
    $domains=[System.Collections.Generic.SortedDictionary[string,object]]::new([System.StringComparer]::Ordinal)
    $manual=[System.Collections.Generic.List[string]]::new()
    $needed=[System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($finding in $AssessmentResult.findings) {
        if ($finding.status -ceq 'FAIL') { $summary[$finding.risk.severity.ToLowerInvariant()+'Findings']++ }
        if ($finding.status -ceq 'MANUAL') { $manual.Add($finding.controlId) }
        [void]$needed.Add($finding.recommendationId)
        if (-not $domains.ContainsKey($finding.area)) { $domains[$finding.area]=@{area=$finding.area;passed=0;failed=0;manual=0;unknown=0;error=0;notApplicable=0} }
        $key=switch -CaseSensitive($finding.status){'PASS'{'passed'};'FAIL'{'failed'};'MANUAL'{'manual'};'UNKNOWN'{'unknown'};'ERROR'{'error'};'NOT_APPLICABLE'{'notApplicable'}}
        $domains[$finding.area][$key]++
    }
    $catalog=[System.Collections.Generic.SortedDictionary[string,object]]::new([System.StringComparer]::Ordinal)
    foreach ($recommendation in $Recommendations) {
        Assert-CloudOpsSdkDto $recommendation 'Recommendation'
        Assert-CloudOpsSdkCondition (-not $catalog.ContainsKey($recommendation.recommendationId))
        $catalog[$recommendation.recommendationId]=$recommendation
    }
    foreach ($id in $needed) { Assert-CloudOpsSdkCondition ($catalog.ContainsKey($id)) }
    $selected=@(foreach ($id in $catalog.PSBase.Keys) { if($needed.Contains($id)){$catalog[$id]} })
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.assessment-report.v1';metadata=$AssessmentResult.metadata;summary=$summary;coverage=$AssessmentResult.coverage;domainPosture=@($domains.PSBase.Values);findings=$AssessmentResult.findings;manualControls=$manual.ToArray();limitations=$Limitations;recommendations=$selected;aiEnrichment=$AiEnrichment} 'ReportModel'
}
Export-ModuleMember -Function @('New-CloudOpsAssessmentReportModel')
