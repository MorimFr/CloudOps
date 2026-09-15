#requires -Version 7.2
[CmdletBinding()]
param([switch] $EmitJson)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
trap { Write-Host $_.Exception.Message; Write-Host $_.ScriptStackTrace; break }
$sdkRoot = Join-Path $PSScriptRoot '../shared/assessment-sdk'
$checks = 0
function Assert-Test {
    param([bool] $Condition, [string] $Name)
    if (-not $Condition) { throw "SDK validation failed: $Name" }
    $script:checks++
}
function Assert-Rejected {
    param([scriptblock] $Action, [string] $Name)
    $rejected = $false
    try { $null = & $Action } catch { $rejected = $true }
    Assert-Test $rejected $Name
}
function Clone-TestValue {
    param([object] $Value)
    # Clone plain fixture data without date coercion or PowerShell 7.5-only flags.
    if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [array]) { return ,@(foreach ($item in $Value) { Clone-TestValue $item }) }
    $copy = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    foreach ($key in $Value.PSBase.Keys) { $copy[$key] = Clone-TestValue $Value[$key] }
    return $copy
}
foreach ($file in Get-ChildItem -LiteralPath $sdkRoot -Filter '*.psm1') {
    $tokens = $null; $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
    Assert-Test ($errors.Count -eq 0) 'Every SDK module parses'
}
Import-Module (Join-Path $sdkRoot 'CloudOps.Assessment.psm1') -Force -DisableNameChecking
$started = [DateTimeOffset]::UtcNow
$filesBefore = @(Get-ChildItem -LiteralPath $sdkRoot -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash })
$timestamp = '2026-09-10T12:00:00Z'
$control = @{id='DEV-CORE-001';title='Synthetic aggregate rule';area='synthetic';order=1;evaluationType='AUTOMATED';collectorRequirements=@('fixture-summary');evaluator='fixture-check';severity='MEDIUM';recommendationId='fixture-review';parameters=@{maximum=0}}
$manual = Clone-TestValue $control
$manual.id='DEV-CORE-002';$manual.order=2;$manual.evaluationType='MANUAL';$manual.evaluator=$null;$manual.collectorRequirements=@()
$pack = @{schemaVersion='cloudops.control-pack.v1';id='cloudops-core-dev';name='Development only';framework='cloudops-development';frameworkVersion='development';controlPackVersion='1.0.0';scope=@('synthetic');source=@{kind='DEVELOPMENT';reference='Synthetic fixture, not an official control'};controls=@($control,$manual)}
$packJson = ConvertTo-Json -InputObject $pack -Depth 32 -Compress
$hash = Get-CloudOpsControlPackHash $packJson
$recommendation = @{recommendationId='fixture-review';title='Review fixture';summary='Synthetic guidance';technicalSteps=@('Inspect fixture');portalPath=@('Development');impact='No tenant changes';rollback=@('No change');validation=@('Repeat fixture')}
$definition = @{schemaVersion='cloudops.assessment-definition.v1';assessmentId='sdk-fixture';assessmentVersion='1.0.0';sdkVersion='cloudops.assessment-sdk.v1';capabilities=@('aggregate-read');aiFactAllowlist=@('count','available','tenantId');collectors=@(@{id='fixture-summary';version='1.0.0';requiredPermissions=@();requiredCapabilities=@('aggregate-read');requiresAuthentication=$false});evaluators=@(@{id='fixture-check';version='1.0.0';collectorRequirements=@('fixture-summary')});recommendations=@($recommendation);controlPacks=@(@{id=$pack.id;version=$pack.controlPackVersion;file='cloudops-core-dev.json';sha256=$hash})}
$context = @{assessmentId='sdk-fixture';assessmentVersion='1.0.0';sdkVersion='cloudops.assessment-sdk.v1';assessmentTimestamp=$timestamp;capabilities=@{'aggregate-read'='AVAILABLE'};dataSource='SYNTHETIC'}
$collectorContext = @{calls=0;count=0;status='SUCCESS'}
$collectors = @{'fixture-summary'={param($CollectorContext,$Context) $CollectorContext.calls++; return @{schemaVersion='cloudops.collector-result.v1';collectorId='fixture-summary';status=$CollectorContext.status;requestCount=1;data=@{count=$CollectorContext.count;available=$true;tenantId=123;notAllowed=789};warnings=@()}}}
$evaluator = {
    param($Control,$State,$Context)
    $count = $State['datasets']['fixture-summary']['facts']['count']
    $status = 'PASS'
    if ($count -gt $Control['parameters']['maximum']) { $status = 'FAIL' }
    return @{schemaVersion='cloudops.control-result.v1';controlId=$Control['id'];status=$status;applicability='APPLICABLE';confidence='HIGH';observed=@{count=$count;available=$true;tenantId=123;notAllowed=789};expected=@{maximum=$Control['parameters']['maximum']};evidence=@(@{type='aggregate-count';facts=@{count=$count}});reasonCode='AGGREGATE_EVALUATED';riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}}
}
$evaluators = @{'fixture-check'=$evaluator}
$state = @{schemaVersion='cloudops.normalized-state.v1';assessmentTimestamp=$timestamp;datasets=@{'fixture-summary'=@{status='SUCCESS';facts=@{count=0}}};capabilities=@{'aggregate-read'='AVAILABLE'}}

# Contracts reject coercion, unexpected data, executable-looking metadata and
# aggregates that could contain identities/raw service responses.
foreach ($pair in @(@($control,'Control'),@($pack,'ControlPack'),@($definition,'Definition'),@($context,'Context'),@($state,'NormalizedState'))) { Assert-CloudOpsSdkDto $pair[0] $pair[1]; $checks++ }
$bad = Clone-TestValue $control; $bad.extra='unexpected'
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Unknown control field'
$bad = Clone-TestValue $control; $bad.parameters=@{count='one'}
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'String fact'
$bad.parameters=@{count=1.5}; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Fraction fact'
foreach ($number in @([double]1.0,[double]1e2,[decimal]12.0)) {
    $bad.parameters=@{count=$number}; Assert-CloudOpsSdkDto $bad 'Control'; $checks++
}
foreach ($number in @([double]::NaN,[double]::PositiveInfinity,[double]::NegativeInfinity,[double]1e-100,[decimal]0.1)) {
    $bad.parameters=@{count=$number}; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Nonfinite or fractional number rejected'
}
$bad.parameters=@{count=9007199254740992L}; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Unsafe integer'
$bad.parameters=@{constructor=1}; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Reserved fact key'
$bad.parameters=@{nested=@{count=1}}; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Raw object fact'
$bad = Clone-TestValue $control; $bad.id='123'; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Control ID starts with letter'
$bad = Clone-TestValue $control; $bad.title='https://invalid.test/script'; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'URL metadata'
$bad.title='<script>alert(1)</script>'; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Control' } 'Markup metadata'
$bad = Clone-TestValue $definition; $bad.collectors += $bad.collectors[0]; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Definition' } 'Duplicate registration'
$bad = Clone-TestValue $definition; $bad.controlPacks[0].file='../escape.json'; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Definition' } 'Pack path traversal'
$bad = Clone-TestValue $definition; $bad.collectors[0].requiredCapabilities=@('unregistered'); Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Definition' } 'Unknown capability'
$bad = Clone-TestValue $context; $bad.accessToken='synthetic-secret'; Assert-Rejected { Assert-CloudOpsSdkDto $bad 'Context' } 'Authentication excluded from safe context'
$clone = Copy-CloudOpsSdkDto $context 'Context'
Assert-Test ($clone.assessmentTimestamp -is [string] -and $clone.assessmentTimestamp -ceq $timestamp) 'UTC string preserved'
$clone.capabilities['aggregate-read']='UNKNOWN'; Assert-Test ($context.capabilities['aggregate-read'] -ceq 'AVAILABLE') 'Context deep clone'
$caseFactsControl = Clone-TestValue $control
$caseFactsControl.parameters = ConvertFrom-Json '{"aB":1,"ab":2}' -AsHashtable
$caseFactsClone = Copy-CloudOpsSdkDto $caseFactsControl 'Control'
Assert-Test ($caseFactsClone.parameters.Count -eq 2 -and $caseFactsClone.parameters['aB'] -eq 1 -and $caseFactsClone.parameters['ab'] -eq 2) 'Fact clone preserves ordinal case-distinct keys'
$prettyJson = ConvertTo-Json $pack -Depth 32
Assert-Test ((Get-CloudOpsControlPackHash ($prettyJson.Replace("`r`n","`n"))) -ceq (Get-CloudOpsControlPackHash ($prettyJson.Replace("`r`n","`n").Replace("`n","`r`n")))) 'Cross-platform normalized pack hash'
Assert-Test ((Read-CloudOpsControlPack $packJson $pack.id '1.0.0' $hash).id -ceq $pack.id) 'Pinned pack reads'
Assert-Rejected { Read-CloudOpsControlPack ($packJson+' ') $pack.id '1.0.0' $hash } 'Modified pack hash'
Assert-Rejected { Read-CloudOpsControlPack $packJson $pack.id '1.0.1' $hash } 'Modified pack version'
$datedPack = Clone-TestValue $pack
$datedPack.name = $timestamp
$datedPack.controls[0].title = $timestamp
$datedJson = ConvertTo-Json $datedPack -Depth 32 -Compress
$datedRead = Read-CloudOpsControlPack $datedJson $datedPack.id $datedPack.controlPackVersion (Get-CloudOpsControlPackHash $datedJson)
Assert-Test ($datedRead.name -is [string] -and $datedRead.controls[0].title -ceq $timestamp) 'ISO-shaped control metadata stays string'
$numericJson = '{"whole":1.0,"exponent":1e2,"fraction":0.1,"aB":1,"ab":2,"nothing":null}'
$numericRead = ConvertFrom-CloudOpsSdkJson $numericJson
Assert-Test ($numericRead.whole -eq 1 -and $numericRead.exponent -eq 100 -and $numericRead.fraction -eq 0.1 -and $numericRead.Count -eq 6 -and $null -eq $numericRead.nothing) 'JSON preserves numeric and ordinal object semantics'
$nullArray = ConvertFrom-CloudOpsSdkJson '[null,1,[null]]'
Assert-Test ($nullArray.Count -eq 3 -and $null -eq $nullArray[0] -and $nullArray[2].Count -eq 1 -and $null -eq $nullArray[2][0]) 'JSON array null entries are preserved, not silently removed'
$nullPack = Clone-TestValue $pack; $nullPack.controls = @($nullPack.controls[0], $null)
$nullPackJson = ConvertTo-Json $nullPack -Depth 32 -Compress
Assert-Rejected { Read-CloudOpsControlPack $nullPackJson $pack.id $pack.controlPackVersion (Get-CloudOpsControlPackHash $nullPackJson) } 'Null control alongside valid control is rejected'
Assert-Rejected { ConvertFrom-CloudOpsSdkJson ('[' * 33 + '0' + ']' * 33) } 'JSON depth bound'
Assert-Rejected { Get-CloudOpsControlPackHash ('é' * 600000) } 'UTF-8 byte limit'

# Planner validates the complete pack before invoking any collector, then plans
# only automated controls and deduplicates its static registry dependencies.
$plan = New-CloudOpsAssessmentPlan $pack $definition $context $collectors $evaluators @() $collectorContext
Assert-Test ($plan.controlIds.Count -eq 2 -and $plan.collectorIds.Count -eq 1 -and $plan.requiredPermissions.Count -eq 0) 'Plan without duplicate collectors'
Assert-Test ($collectorContext.calls -eq 0) 'Planner is IO-free'
$bad = Clone-TestValue $pack; $bad.controls[1].collectorRequirements=@('unknown-collector')
Assert-Rejected { New-CloudOpsAssessmentPlan $bad $definition $context $collectors $evaluators @() $collectorContext @('DEV-CORE-001') } 'Unknown collector in unselected manual control'
$bad = Clone-TestValue $pack; $bad.controls[1].recommendationId='unknown-recommendation'
Assert-Rejected { New-CloudOpsAssessmentPlan $bad $definition $context $collectors $evaluators @() $collectorContext @('DEV-CORE-001') } 'Unknown recommendation in unselected control'
$bad = Clone-TestValue $pack; $bad.controls[0].evaluator='unknown-evaluator'
Assert-Rejected { New-CloudOpsAssessmentPlan $bad $definition $context $collectors $evaluators @() $collectorContext } 'Unknown evaluator'
Assert-Rejected { New-CloudOpsAssessmentPlan $pack $definition $context $collectors $evaluators @() $collectorContext @('DEV-UNKNOWN') } 'Unknown selection'
Assert-Rejected { New-CloudOpsAssessmentPlan $pack $definition $context $collectors $evaluators @() $collectorContext @('DEV-CORE-001','DEV-CORE-001') } 'Duplicate selection'
Assert-Rejected { New-CloudOpsAssessmentPlan $pack $definition $context $collectors $evaluators @() $collectorContext @() } 'Explicit empty selection'
$doubleOrderPack = Clone-TestValue $pack; $doubleOrderPack.controls[0].order = [double]1.0
Assert-Test ((New-CloudOpsAssessmentPlan $doubleOrderPack $definition $context $collectors $evaluators @() $collectorContext).controlIds[0] -ceq 'DEV-CORE-001') 'Integral JSON order sorts without CLR-specific formatting'
$secured = Clone-TestValue $definition; $secured.collectors[0].requiresAuthentication=$true; $secured.collectors[0].requiredPermissions=@('Read.All','Read.Basic')
Assert-Rejected { New-CloudOpsAssessmentPlan $pack $secured $context $collectors $evaluators @('Read.Basic') $collectorContext @('DEV-CORE-002') } 'Unselected automated scope cannot evade preflight'
Assert-Rejected { New-CloudOpsAssessmentPlan $pack $secured $context $collectors $evaluators @('Read.All','Read.Basic') $null } 'Collector auth missing'
$securedPlan = New-CloudOpsAssessmentPlan $pack $secured $context $collectors $evaluators @('Read.Basic','Read.All') $collectorContext
Assert-Test (($securedPlan.requiredPermissions -join ',') -ceq 'Read.All,Read.Basic') 'Permission union sorted'
Assert-Test ($collectorContext.calls -eq 0) 'All rejected preflights have zero calls'

# Pure evaluator allowlist: command/Graph/IO/reflection/clock/scoped variables
# are rejected before a runspace is created. Invalid output/error is never FAIL.
foreach ($code in @(
    'param($Control,$State,$Context) Get-Date',
    'param($Control,$State,$Context) Invoke-RestMethod https://invalid.test',
    'param($Control,$State,$Context) Get-Content /etc/passwd',
    'param($Control,$State,$Context) [DateTime]::UtcNow',
    'param($Control,$State,$Context) $env:SDK_SECRET',
    'param($Control,$State,$Context) $global:secret',
    'param($Control,$State,$Context) $ExecutionContext',
    'param($Control,$State,$Context) $State.Clear()',
    'param($Control,$State,$Context) & $Control',
    'param($Control,$State,$Context) $State["count"]=4',
    'param($Control,$State,$Context) $(Get-Date)',
    'param($Control,$State,$Context) { Get-Date }',
    'param($Control,$State,$Context) "value $Context"'
)) { $unsafe = [scriptblock]::Create($code); Assert-Rejected { Assert-CloudOpsPureScript $unsafe } 'Unsafe evaluator syntax rejected' }
$directResult = Invoke-CloudOpsPureScript $evaluator @($control,$state,$context)
Assert-Test ($directResult.status -ceq 'PASS') 'Pure evaluator runspace executes safe DTO calculation'
$baselineResult = Invoke-CloudOpsEvaluation $control $state $context $evaluator
Assert-Test ($baselineResult.status -ceq 'PASS') 'Automated PASS fixture'
$deterministic = ConvertTo-Json $baselineResult -Depth 32 -Compress
for ($iteration=0; $iteration -lt 100; $iteration++) {
    $again = Invoke-CloudOpsEvaluation $control $state $context $evaluator
    Assert-Test ((ConvertTo-Json $again -Depth 32 -Compress) -ceq $deterministic) '100-run evaluator determinism'
}
$state.datasets['fixture-summary'].facts.count=4
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $evaluator).status -ceq 'FAIL') 'Automated FAIL fixture'
$state.datasets['fixture-summary'].status='PARTIAL'
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $evaluator).status -ceq 'UNKNOWN') 'Partial is UNKNOWN, not FAIL'
$state.datasets['fixture-summary'].status='FAILED'
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $evaluator).status -ceq 'ERROR') 'Failed collector is ERROR, not FAIL'
$missingState = Clone-TestValue $state; $missingState.datasets=@{}
Assert-Test ((Invoke-CloudOpsEvaluation $control $missingState $context $evaluator).status -ceq 'UNKNOWN') 'Missing dataset is UNKNOWN'
$state.datasets['fixture-summary'].status='SUCCESS'
$infinite = {param($Control,$State,$Context) while($true) {}}
$budgetWatch = [System.Diagnostics.Stopwatch]::StartNew()
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $infinite -TimeoutMilliseconds 20).status -ceq 'ERROR') 'Evaluator timeout is ERROR'
Assert-Test ($budgetWatch.Elapsed.TotalSeconds -lt 5) 'Evaluator timeout is bounded'
$invalidResult = {param($Control,$State,$Context) @{status='FAIL'}}
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $invalidResult).status -ceq 'ERROR') 'Invalid output is ERROR'
$divisionError = {param($Control,$State,$Context) $bad = 1/0; return $bad}
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $divisionError).status -ceq 'ERROR') 'Runtime evaluator error is ERROR'
Assert-Test ((Invoke-CloudOpsEvaluation $manual $state $context $null).status -ceq 'MANUAL') 'Manual fallback'
$hybrid = Clone-TestValue $control; $hybrid.evaluationType='HYBRID'
Assert-Test ((Invoke-CloudOpsEvaluation $hybrid $state $context $evaluator).status -ceq 'MANUAL') 'Hybrid v1 fallback'
$notApplicable = {param($Control,$State,$Context) return @{schemaVersion='cloudops.control-result.v1';controlId=$Control['id'];status='NOT_APPLICABLE';applicability='NOT_APPLICABLE';confidence='HIGH';observed=@{};expected=@{};evidence=@();reasonCode='CAPABILITY_UNAVAILABLE';riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}}}
Assert-Test ((Invoke-CloudOpsEvaluation $control $state $context $notApplicable).status -ceq 'NOT_APPLICABLE') 'Not applicable retained'

# Deterministic severity arithmetic cannot drop below the metadata baseline.
foreach ($level in @('LOW','MEDIUM','HIGH','CRITICAL')) {
    foreach ($exposed in @($false,$true)) { foreach ($privileged in @($false,$true)) { foreach ($compensating in @($false,$true)) {
        $risk = Get-CloudOpsRisk $level @{exposed=$exposed;privileged=$privileged;compensatingControl=$compensating}
        $levels=@('LOW','MEDIUM','HIGH','CRITICAL'); $expected=$levels[[Math]::Min(3,[Array]::IndexOf($levels,$level)+[Math]::Max(0,[int]$exposed+[int]$privileged-[int]$compensating))]
        Assert-Test ($risk.baseSeverity -ceq $level -and $risk.severity -ceq $expected) 'Risk truth table'
    } } }
}
$badRisk = @{modelVersion='cloudops.risk.v1';baseSeverity='CRITICAL';severity='LOW';signals=@{exposed=$false;privileged=$false;compensatingControl=$true}}
Assert-Rejected { Assert-CloudOpsSdkDto $badRisk 'Risk' } 'Risk tampering rejected'

Assert-Rejected { Invoke-CloudOpsAssessment -ControlPackJson ($packJson+' ') -Definition $definition -CollectorRegistry $collectors -EvaluatorRegistry $evaluators -Context $context -ControlPackHash $hash -CollectorContext $collectorContext } 'Altered pack source fails before collection'
Assert-Test ($collectorContext.calls -eq 0) 'Tampered source did not invoke collectors'
$execution = Invoke-CloudOpsAssessment -ControlPackJson $packJson -Definition $definition -CollectorRegistry $collectors -EvaluatorRegistry $evaluators -Context $context -ControlPackHash $hash -CollectorContext $collectorContext
Assert-Test ($collectorContext.calls -eq 1) 'Exactly one shared collector execution'
Assert-Test ($execution.result.findings.Count -eq 2 -and $execution.result.findings[0].status -ceq 'PASS' -and $execution.result.findings[1].status -ceq 'MANUAL') 'End-to-end synthetic result'
Assert-Test ($execution.result.coverage.evaluatedPassRate.percent -eq 100 -and $execution.result.coverage.evaluationCoverage.percent -eq 50) 'Coverage denominators are distinct'
Assert-Test ($execution.reportModel.summary.mediumFindings -eq 0 -and $execution.reportModel.manualControls.Count -eq 1) 'Executive summary excludes passing/manual potential risk'
$snapshot = ConvertTo-Json $execution.result -Depth 32 -Compress
$execution.reportModel.findings[0].observed.count=999
Assert-Test ((ConvertTo-Json $execution.result -Depth 32 -Compress) -ceq $snapshot) 'Report model does not share authoritative references'
$execution.reportModel = New-CloudOpsAssessmentReportModel $execution.result @($recommendation) @{schemaVersion='cloudops.ai-enrichment.v1';status='NOT_REQUESTED';advisory=$null}
$bad = Clone-TestValue $execution.result; $bad.metadata.evaluatorVersions=@{}
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'AssessmentResult' } 'Missing evaluator provenance rejected'
$bad = Clone-TestValue $execution.result; $bad.coverage.manualResultControls=0
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'AssessmentResult' } 'Coverage partitions reconcile'
$bad = Clone-TestValue $execution.reportModel; $bad.domainPosture[0].failed++
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'ReportModel' } 'Domain posture reconciles'
$bad = Clone-TestValue $execution.reportModel; $bad.recommendations=@()
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'ReportModel' } 'Recommendation references reconcile'
$bad = Clone-TestValue $execution.reportModel; $bad.summary.highFindings=99
Assert-Rejected { Assert-CloudOpsSdkDto $bad 'ReportModel' } 'Executive severity summary reconciles'

# AI sees only approved aggregate keys. Pure fake providers exercise success,
# timeout, unavailable, invalid output and mutation attempts without any network.
$aiInput = ConvertTo-CloudOpsAiInput $execution.result $definition.aiFactAllowlist
Assert-Test ($aiInput.findings[0].facts.Count -eq 2 -and $aiInput.findings[0].facts.count -eq 0 -and $aiInput.findings[0].facts.available) 'AI allowlist includes approved aggregate facts'
Assert-Test (-not $aiInput.findings[0].facts.Contains('tenantId') -and -not $aiInput.findings[0].facts.Contains('notAllowed')) 'AI identifier aliases and non-allowlisted facts excluded'
Assert-Test ((ConvertTo-Json $aiInput -Depth 32 -Compress) -notmatch '(?:title|recommendation|assessmentTimestamp|framework|tenantId|notAllowed|raw|token)') 'AI input minimized'
$aiInput.findings[0].facts.count=222
Assert-Test ((ConvertTo-Json $execution.result -Depth 32 -Compress) -ceq $snapshot) 'Sanitizer output is a separate clone'
$fake = {param($AiInput) return @{schemaVersion='cloudops.ai-enrichment.v1';status='AVAILABLE';advisory=@{executiveNarrative='Synthetic advisory';technicalExplanation='Aggregate fixture';riskContext='Informative only';crossFindingCorrelations=@();remediationPriority=@('Review the failed control');roadmapSuggestions=@('Obtain human approval')}}}
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result $definition.aiFactAllowlist $fake).status -ceq 'AVAILABLE') 'Optional fake advisory accepted'
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result @() $null).status -ceq 'NOT_REQUESTED') 'No AI requested'
$aiUnavailable = {param($AiInput) return @{schemaVersion='cloudops.ai-enrichment.v1';status='UNAVAILABLE';advisory=$null}}
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result @() $aiUnavailable).status -ceq 'UNAVAILABLE') 'Provider unavailable'
$aiInfinite = {param($AiInput) while($true) {}}
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result @() $aiInfinite -TimeoutMilliseconds 20).status -ceq 'UNAVAILABLE') 'AI timeout does not fail assessment'
$aiError = {param($AiInput) $bad = 1/0; return $bad}
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result @() $aiError).status -ceq 'UNAVAILABLE') 'AI error does not fail assessment'
foreach ($field in @('status','evidence','baseSeverity','applicability','collectorResult','controlDefinition','controlPackVersion')) {
    $attack = [scriptblock]::Create('param($AiInput) return @{schemaVersion=''cloudops.ai-enrichment.v1'';status=''AVAILABLE'';advisory=@{executiveNarrative=''Synthetic'';technicalExplanation=''Synthetic'';riskContext=''Synthetic'';crossFindingCorrelations=@();remediationPriority=@();roadmapSuggestions=@();' + $field + '=''TAMPERED''}}')
    Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result $definition.aiFactAllowlist $attack).status -ceq 'UNAVAILABLE') 'AI authoritative field injection rejected'
}
$mutation = {param($AiInput) $AiInput['findings'][0]['status']='PASS'; return @{schemaVersion='cloudops.ai-enrichment.v1';status='UNAVAILABLE';advisory=$null}}
Assert-Test ((Invoke-CloudOpsAiEnrichment $execution.result @() $mutation).status -ceq 'UNAVAILABLE') 'Provider mutation syntax rejected'
Assert-Test ((ConvertTo-Json $execution.result -Depth 32 -Compress) -ceq $snapshot) 'AI never changed authoritative results'
$collectorContext.status='FAILED'
$failedExecution = Invoke-CloudOpsAssessment -ControlPackJson $packJson -Definition $definition -CollectorRegistry $collectors -EvaluatorRegistry $evaluators -Context $context -ControlPackHash $hash -CollectorContext $collectorContext -AiProvider $aiInfinite -AiTimeoutMilliseconds 20
Assert-Test ($failedExecution.result.findings[0].status -ceq 'ERROR' -and $failedExecution.reportModel.aiEnrichment.status -ceq 'UNAVAILABLE') 'Assessment and report complete despite collection and AI failure'
$filesAfter = @(Get-ChildItem -LiteralPath $sdkRoot -Recurse -File | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash })
Assert-Test (($filesBefore -join '|') -ceq ($filesAfter -join '|')) 'SDK source snapshot unchanged'
Assert-Test (@(Get-Module -Name 'CloudOps.Graph').Count -eq 0) 'Generic SDK has no Graph module dependency'
if ($EmitJson) { ConvertTo-Json -InputObject @{checks=$checks;result=$execution.result;reportModel=$execution.reportModel} -Depth 32 -Compress }
else { Write-Host "Assessment SDK validation passed: $checks checks; 100 deterministic evaluator runs; memory-only synthetic execution." }
