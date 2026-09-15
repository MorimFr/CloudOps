Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Risk.psm1') -DisableNameChecking
function New-CloudOpsFinding {
    param([object] $Control, [object] $ControlResult, [AllowNull()] [object] $EvaluatorDefinition)
    Assert-CloudOpsSdkDto $Control 'Control'; Assert-CloudOpsSdkDto $ControlResult 'ControlResult'
    Assert-CloudOpsSdkCondition ($Control.id -ceq $ControlResult.controlId)
    $executed = $Control.evaluationType -ceq 'AUTOMATED'
    $evaluation = @{type=$Control.evaluationType;confidence=$ControlResult.confidence;evaluatorId=$null;evaluatorVersion=$null}
    if ($executed) { Assert-CloudOpsSdkCondition ($null -ne $EvaluatorDefinition -and $EvaluatorDefinition.id -ceq $Control.evaluator); $evaluation.evaluatorId=$EvaluatorDefinition.id; $evaluation.evaluatorVersion=$EvaluatorDefinition.version }
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.finding.v1';controlId=$Control.id;title=$Control.title;area=$Control.area;status=$ControlResult.status;applicability=$ControlResult.applicability;evaluation=$evaluation;risk=(Get-CloudOpsRisk $Control.severity $ControlResult.riskSignals);observed=$ControlResult.observed;expected=$ControlResult.expected;evidence=$ControlResult.evidence;reasonCode=$ControlResult.reasonCode;recommendationId=$Control.recommendationId} 'Finding'
}
function New-CloudOpsCoverageRatio {
    param([long] $Numerator, [long] $Denominator)
    return @{numerator=$Numerator;denominator=$Denominator;percent=$(if($Denominator -eq 0){$null}else{[Math]::Floor($Numerator/[double]$Denominator*10000+0.5)/100})}
}
function Get-CloudOpsAssessmentCoverage {
    param([AllowEmptyCollection()] [object[]] $Findings)
    $coverage = [ordered]@{totalControls=$Findings.Count;applicableControls=0;applicabilityUnknownControls=0;automatedControls=0;manualControls=0;hybridControls=0;manualResultControls=0;successfullyEvaluatedControls=0;passedControls=0;failedControls=0;unknownControls=0;errorControls=0;notApplicableControls=0}
    foreach ($finding in $Findings) {
        Assert-CloudOpsSdkDto $finding 'Finding'
        switch -CaseSensitive ($finding.applicability) { 'APPLICABLE' {$coverage.applicableControls++}; 'UNKNOWN' {$coverage.applicabilityUnknownControls++} }
        switch -CaseSensitive ($finding.evaluation.type) { 'AUTOMATED' {$coverage.automatedControls++}; 'MANUAL' {$coverage.manualControls++}; 'HYBRID' {$coverage.hybridControls++} }
        switch -CaseSensitive ($finding.status) { 'PASS' {$coverage.passedControls++}; 'FAIL' {$coverage.failedControls++}; 'MANUAL' {$coverage.manualResultControls++}; 'UNKNOWN' {$coverage.unknownControls++}; 'ERROR' {$coverage.errorControls++}; 'NOT_APPLICABLE' {$coverage.notApplicableControls++} }
    }
    $coverage.successfullyEvaluatedControls=$coverage.passedControls+$coverage.failedControls
    $coverage.automationCoverage=New-CloudOpsCoverageRatio $coverage.automatedControls $coverage.totalControls
    $coverage.evaluatedPassRate=New-CloudOpsCoverageRatio $coverage.passedControls $coverage.successfullyEvaluatedControls
    $coverage.evaluationCoverage=New-CloudOpsCoverageRatio $coverage.successfullyEvaluatedControls ($coverage.totalControls-$coverage.notApplicableControls)
    Assert-CloudOpsSdkDto $coverage 'Coverage'
    return $coverage
}
function New-CloudOpsAssessmentResult {
    param([object] $Metadata, [AllowEmptyCollection()] [object[]] $Findings)
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.assessment-result.v1';metadata=$Metadata;coverage=(Get-CloudOpsAssessmentCoverage $Findings);findings=$Findings} 'AssessmentResult'
}
Export-ModuleMember -Function @('New-CloudOpsFinding','Get-CloudOpsAssessmentCoverage','New-CloudOpsAssessmentResult')
