#requires -Version 7.2
Set-StrictMode -Version Latest
foreach ($module in @('Validation','ControlPack','Planner','Collector','Normalization','Evaluation','Evidence','Finding','Risk','AiBoundary','ReportModel')) {
    Import-Module (Join-Path $PSScriptRoot ($module+'.psm1')) -DisableNameChecking
}
function Invoke-CloudOpsAssessment {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $ControlPackJson, [Parameter(Mandatory)] [object] $Definition,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $CollectorRegistry, [Parameter(Mandatory)] [System.Collections.IDictionary] $EvaluatorRegistry,
        [Parameter(Mandatory)] [object] $Context, [Parameter(Mandatory)] [string] $ControlPackHash,
        [AllowEmptyCollection()] [string[]] $ManifestPermissions=@(), [AllowNull()] [object] $CollectorContext,
        [AllowNull()] [AllowEmptyCollection()] [string[]] $SelectedControlIds=$null, [AllowNull()] [scriptblock] $AiProvider,
        [ValidateRange(1,10000)] [int] $AiTimeoutMilliseconds=1000,
        [AllowEmptyCollection()] [string[]] $Limitations=@(), [AllowNull()] [scriptblock] $ProgressCallback)
    $definitionCopy=Copy-CloudOpsSdkDto $Definition 'Definition'
    $contextCopy=Copy-CloudOpsSdkDto $Context 'Context'
    Assert-CloudOpsSdkCondition ($ControlPackHash -cmatch '^[a-f0-9]{64}$')
    $matching=@($definitionCopy.controlPacks | Where-Object {$_.sha256 -ceq $ControlPackHash})
    Assert-CloudOpsSdkCondition ($matching.Count -eq 1)
    # Parse only the pinned source text. Accepting a mutable DTO beside a caller-
    # supplied hash could otherwise attribute altered controls to an old pin.
    $pack=Read-CloudOpsControlPack $ControlPackJson $matching[0].id $matching[0].version $ControlPackHash
    $plan=New-CloudOpsAssessmentPlan $pack $definitionCopy $contextCopy $CollectorRegistry $EvaluatorRegistry $ManifestPermissions $CollectorContext $SelectedControlIds
    # Validate every implementation before any collection; invalid developer
    # registration is a preflight error, never a partial assessment result.
    foreach ($evaluator in $definitionCopy.evaluators) { $null=Assert-CloudOpsPureScript $EvaluatorRegistry[$evaluator.id] }
    $collected=$null; $state=$null; $findings=[System.Collections.Generic.List[object]]::new()
    try {
        if($null -ne $ProgressCallback){$null=& $ProgressCallback 'PROCESSING' 25}
        $collected=Invoke-CloudOpsCollectors $plan $CollectorRegistry $contextCopy $CollectorContext
        $CollectorContext=$null
        $state=New-CloudOpsNormalizedState $collected $contextCopy
        $collected=$null
        if($null -ne $ProgressCallback){$null=& $ProgressCallback 'PROCESSING' 60}
        $controls=New-CloudOpsSdkRegistry $pack.controls
        $evaluators=New-CloudOpsSdkRegistry $definitionCopy.evaluators
        $versions=[ordered]@{}
        foreach ($id in $plan.controlIds) {
            $control=$controls[$id]
            $evaluatorDefinition=$null; $implementation=$null
            if($null -ne $control.evaluator){$evaluatorDefinition=$evaluators[$control.evaluator];$implementation=$EvaluatorRegistry[$control.evaluator]}
            $controlResult=Invoke-CloudOpsEvaluation $control $state $contextCopy $implementation
            $findings.Add((New-CloudOpsFinding $control $controlResult $evaluatorDefinition))
            if($control.evaluationType -ceq 'AUTOMATED'){$versions[$evaluatorDefinition.id]=$evaluatorDefinition.version}
        }
        $state=$null
        if($null -ne $ProgressCallback){$null=& $ProgressCallback 'PROCESSING' 80}
        $metadata=@{assessmentId=$contextCopy.assessmentId;assessmentVersion=$contextCopy.assessmentVersion;sdkVersion=$contextCopy.sdkVersion;assessmentTimestamp=$contextCopy.assessmentTimestamp;framework=$pack.framework;frameworkVersion=$pack.frameworkVersion;controlPackId=$pack.id;controlPackVersion=$pack.controlPackVersion;controlPackHash=$ControlPackHash;evaluatorVersions=$versions;dataSource=$contextCopy.dataSource}
        $result=New-CloudOpsAssessmentResult $metadata $findings.ToArray()
        $enrichment=Invoke-CloudOpsAiEnrichment $result $definitionCopy.aiFactAllowlist $AiProvider $AiTimeoutMilliseconds
        $report=New-CloudOpsAssessmentReportModel $result $definitionCopy.recommendations $enrichment $Limitations
        return @{result=$result;reportModel=$report}
    } finally { $CollectorContext=$null; $collected=$null; $state=$null; $findings.Clear(); $pack=$null; $definitionCopy=$null; $contextCopy=$null }
}
Export-ModuleMember -Function @('Invoke-CloudOpsAssessment','Assert-CloudOpsSdkDto','Copy-CloudOpsSdkDto','Get-CloudOpsSdkMap','ConvertFrom-CloudOpsSdkJson','Get-CloudOpsControlPackHash','Read-CloudOpsControlPack','New-CloudOpsAssessmentPlan','Invoke-CloudOpsCollectors','New-CloudOpsNormalizedState','Assert-CloudOpsPureScript','Invoke-CloudOpsPureScript','Invoke-CloudOpsEvaluation','New-CloudOpsEvidence','New-CloudOpsFinding','Get-CloudOpsRisk','Get-CloudOpsAssessmentCoverage','New-CloudOpsAssessmentResult','ConvertTo-CloudOpsAiInput','Invoke-CloudOpsAiEnrichment','New-CloudOpsAssessmentReportModel')
