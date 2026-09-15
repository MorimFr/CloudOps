#requires -Version 7.2
Set-StrictMode -Version Latest

# DTO validation deliberately rejects coercion, custom CLR objects, getters,
# unknown keys and oversized aggregate data before JSON serialization.
function Assert-CloudOpsSdkCondition {
    param([bool] $Condition)
    if (-not $Condition) { throw [System.ArgumentException]::new('Assessment SDK contract validation failed.') }
}
function Get-CloudOpsSdkMap {
    param([AllowNull()] [object] $Value)
    Assert-CloudOpsSdkCondition ($null -ne $Value)
    if ($Value.GetType().FullName -ceq 'System.Management.Automation.PSCustomObject') {
        $map = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
        foreach ($property in $Value.PSObject.Properties) {
            Assert-CloudOpsSdkCondition ($property.MemberType -eq [System.Management.Automation.PSMemberTypes]::NoteProperty)
            $map[$property.Name] = $property.Value
        }
        return $map
    }
    Assert-CloudOpsSdkCondition ($Value.GetType().FullName -cin @('System.Collections.Hashtable', 'System.Collections.Specialized.OrderedDictionary', 'System.Management.Automation.OrderedHashtable'))
    return $Value
}
function Assert-CloudOpsSdkFields {
    param([object] $Value, [string[]] $Fields)
    $map = Get-CloudOpsSdkMap $Value
    Assert-CloudOpsSdkCondition ($map.PSBase.Count -eq $Fields.Count)
    foreach ($key in $map.PSBase.Keys) { Assert-CloudOpsSdkCondition ($key -is [string] -and $key -cin $Fields) }
}
function Assert-CloudOpsSdkText {
    param([AllowNull()] [object] $Value, [int] $Maximum = 500)
    Assert-CloudOpsSdkCondition ($Value -is [string])
    Assert-CloudOpsSdkCondition ($Value.Length -gt 0 -and $Value.Length -le $Maximum -and $Value.Trim().Length -gt 0 -and $Value -notmatch '[<>\p{Cc}\p{Cf}]' -and $Value -notmatch '(?:\b[a-z][a-z0-9+.-]*:\S|www\.)')
}
function Assert-CloudOpsSdkId {
    param([AllowNull()] [object] $Value, [switch] $Control)
    $pattern = if ($Control) { '^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$' } else { '^[a-z0-9]+(?:-[a-z0-9]+)*$' }
    $limit = if ($Control) { 96 } else { 64 }
    Assert-CloudOpsSdkCondition ($Value -is [string] -and $Value.Length -le $limit -and $Value -cmatch $pattern)
}
function Assert-CloudOpsSdkInteger {
    param([AllowNull()] [object] $Value, [long] $Minimum = 0, [long] $Maximum = 9007199254740991)
    Assert-CloudOpsSdkCondition ($null -ne $Value -and $Value.GetType().FullName -cin @('System.Byte','System.SByte','System.Int16','System.UInt16','System.Int32','System.UInt32','System.Int64','System.Single','System.Double','System.Decimal'))
    Assert-CloudOpsSdkCondition ($Value -ge $Minimum -and $Value -le $Maximum)
    if ($Value -is [double] -or $Value -is [single]) { Assert-CloudOpsSdkCondition (-not [double]::IsNaN($Value) -and -not [double]::IsInfinity($Value) -and [Math]::Truncate([double]$Value) -eq [double]$Value) }
    if ($Value -is [decimal]) { Assert-CloudOpsSdkCondition ([decimal]::Truncate($Value) -eq $Value) }
}
function Assert-CloudOpsSdkEnum {
    param([AllowNull()] [object] $Value, [string[]] $Values)
    Assert-CloudOpsSdkCondition ($Value -is [string] -and $Value -cin $Values)
}
function Assert-CloudOpsSdkVersion {
    param([AllowNull()] [object] $Value)
    Assert-CloudOpsSdkCondition ($Value -is [string] -and $Value.Length -le 32 -and $Value -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
}
function Assert-CloudOpsSdkArray {
    param([AllowNull()] [object] $Value, [int] $Maximum = 1000, [int] $Minimum = 0)
    Assert-CloudOpsSdkCondition ($Value -is [array] -and $Value.Count -ge $Minimum -and $Value.Count -le $Maximum)
}
function Assert-CloudOpsSdkIds {
    param([object] $Value, [int] $Maximum = 1000, [switch] $Control)
    Assert-CloudOpsSdkArray $Value $Maximum
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($id in $Value) { Assert-CloudOpsSdkId $id -Control:$Control; Assert-CloudOpsSdkCondition ($seen.Add($id)) }
}
function Assert-CloudOpsSdkFacts {
    param([object] $Value)
    $map = Get-CloudOpsSdkMap $Value
    Assert-CloudOpsSdkCondition ($map.PSBase.Count -le 64)
    foreach ($key in $map.PSBase.Keys) {
        Assert-CloudOpsSdkCondition ($key -is [string] -and $key -cmatch '^[a-z][A-Za-z0-9]{0,47}$' -and $key -cnotin @('constructor','prototype','toString','valueOf'))
        if ($null -ne $map[$key] -and $map[$key] -isnot [bool]) { Assert-CloudOpsSdkInteger $map[$key] -Minimum -9007199254740991 }
    }
}
function Assert-CloudOpsSdkCapabilities {
    param([object] $Value)
    $map = Get-CloudOpsSdkMap $Value
    Assert-CloudOpsSdkCondition ($map.PSBase.Count -le 64)
    foreach ($key in $map.PSBase.Keys) { Assert-CloudOpsSdkId $key; Assert-CloudOpsSdkEnum $map[$key] @('AVAILABLE','UNAVAILABLE','UNKNOWN') }
}
function Assert-CloudOpsSdkTimestamp {
    param([object] $Value)
    $parsed = [DateTimeOffset]::MinValue
    Assert-CloudOpsSdkCondition ($Value -is [string] -and $Value -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$' -and [DateTimeOffset]::TryParse($Value, [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref] $parsed))
}
function Assert-CloudOpsSdkTexts {
    param([object] $Value, [int] $Maximum = 100, [int] $TextMaximum = 1000)
    Assert-CloudOpsSdkArray $Value $Maximum
    foreach ($text in $Value) { Assert-CloudOpsSdkText $text $TextMaximum }
}
function Assert-CloudOpsSdkDto {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object] $Value, [Parameter(Mandatory)] [string] $Kind)
    $v = Get-CloudOpsSdkMap $Value
    switch -CaseSensitive ($Kind) {
        'Control' {
            Assert-CloudOpsSdkFields $v @('id','title','area','order','evaluationType','collectorRequirements','evaluator','severity','recommendationId','parameters')
            Assert-CloudOpsSdkId $v.id -Control; Assert-CloudOpsSdkText $v.title; Assert-CloudOpsSdkId $v.area
            Assert-CloudOpsSdkInteger $v.order 1 10000; Assert-CloudOpsSdkEnum $v.evaluationType @('AUTOMATED','MANUAL','HYBRID')
            Assert-CloudOpsSdkIds $v.collectorRequirements 32
            if ($null -ne $v.evaluator) { Assert-CloudOpsSdkId $v.evaluator }
            Assert-CloudOpsSdkCondition (($v.evaluationType -cne 'AUTOMATED' -or $null -ne $v.evaluator) -and ($v.evaluationType -cne 'MANUAL' -or $null -eq $v.evaluator))
            Assert-CloudOpsSdkEnum $v.severity @('LOW','MEDIUM','HIGH','CRITICAL'); Assert-CloudOpsSdkId $v.recommendationId; Assert-CloudOpsSdkFacts $v.parameters
        }
        'ControlPack' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','id','name','framework','frameworkVersion','controlPackVersion','scope','source','controls')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.control-pack.v1'); Assert-CloudOpsSdkId $v.id; Assert-CloudOpsSdkText $v.name
            Assert-CloudOpsSdkId $v.framework; Assert-CloudOpsSdkText $v.frameworkVersion; Assert-CloudOpsSdkVersion $v.controlPackVersion
            Assert-CloudOpsSdkIds $v.scope 32; Assert-CloudOpsSdkCondition ($v.scope.Count -gt 0)
            Assert-CloudOpsSdkFields $v.source @('kind','reference'); Assert-CloudOpsSdkEnum $v.source.kind @('DEVELOPMENT','AUTHORIZED'); Assert-CloudOpsSdkText $v.source.reference 500
            Assert-CloudOpsSdkArray $v.controls 1000 1
            $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($control in $v.controls) {
                Assert-CloudOpsSdkDto $control 'Control'; Assert-CloudOpsSdkCondition ($seen.Add($control.id) -and $control.area -cin $v.scope)
            }
        }
        'Recommendation' {
            Assert-CloudOpsSdkFields $v @('recommendationId','title','summary','technicalSteps','portalPath','impact','rollback','validation')
            Assert-CloudOpsSdkId $v.recommendationId; Assert-CloudOpsSdkText $v.title; Assert-CloudOpsSdkText $v.summary
            Assert-CloudOpsSdkTexts $v.technicalSteps 32 500; Assert-CloudOpsSdkTexts $v.portalPath 12 500; Assert-CloudOpsSdkText $v.impact
            Assert-CloudOpsSdkTexts $v.rollback 32 500; Assert-CloudOpsSdkTexts $v.validation 32 500
        }
        'Definition' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','assessmentId','assessmentVersion','sdkVersion','capabilities','aiFactAllowlist','collectors','evaluators','recommendations','controlPacks')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.assessment-definition.v1'); Assert-CloudOpsSdkId $v.assessmentId; Assert-CloudOpsSdkVersion $v.assessmentVersion
            Assert-CloudOpsSdkEnum $v.sdkVersion @('cloudops.assessment-sdk.v1'); Assert-CloudOpsSdkIds $v.capabilities 64
            Assert-CloudOpsSdkArray $v.aiFactAllowlist 64
            $factNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($key in $v.aiFactAllowlist) { Assert-CloudOpsSdkCondition ($key -is [string] -and $key -cmatch '^[a-z][A-Za-z0-9]{0,47}$' -and $key -cnotin @('constructor','prototype','toString','valueOf') -and $factNames.Add($key)) }
            Assert-CloudOpsSdkArray $v.collectors 100
            Assert-CloudOpsSdkArray $v.evaluators 1000
            Assert-CloudOpsSdkArray $v.recommendations 1000
            Assert-CloudOpsSdkArray $v.controlPacks 32 1
            $registeredCollectors = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($collector in $v.collectors) {
                Assert-CloudOpsSdkFields $collector @('id','version','requiredPermissions','requiredCapabilities','requiresAuthentication')
                Assert-CloudOpsSdkId $collector.id; Assert-CloudOpsSdkVersion $collector.version; Assert-CloudOpsSdkIds $collector.requiredCapabilities 32
                Assert-CloudOpsSdkCondition ($registeredCollectors.Add($collector.id))
                foreach ($capability in $collector.requiredCapabilities) { Assert-CloudOpsSdkCondition ($capability -cin $v.capabilities) }
                Assert-CloudOpsSdkArray $collector.requiredPermissions 32
                $permissions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
                foreach ($permission in $collector.requiredPermissions) {
                    Assert-CloudOpsSdkCondition ($permission -is [string] -and $permission.Length -le 100 -and $permission -cmatch '^[A-Za-z][A-Za-z0-9.:-]*$' -and $permissions.Add($permission))
                }
                Assert-CloudOpsSdkCondition ($collector.requiresAuthentication -is [bool] -and ($collector.requiresAuthentication -or $collector.requiredPermissions.Count -eq 0))
            }
            $registeredEvaluators = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($evaluator in $v.evaluators) {
                Assert-CloudOpsSdkFields $evaluator @('id','version','collectorRequirements'); Assert-CloudOpsSdkId $evaluator.id; Assert-CloudOpsSdkVersion $evaluator.version; Assert-CloudOpsSdkIds $evaluator.collectorRequirements 32
                Assert-CloudOpsSdkCondition ($registeredEvaluators.Add($evaluator.id))
                foreach ($collectorId in $evaluator.collectorRequirements) { Assert-CloudOpsSdkCondition ($registeredCollectors.Contains($collectorId)) }
            }
            $registeredRecommendations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($recommendation in $v.recommendations) { Assert-CloudOpsSdkDto $recommendation 'Recommendation'; Assert-CloudOpsSdkCondition ($registeredRecommendations.Add($recommendation.recommendationId)) }
            $registeredPacks = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($pack in $v.controlPacks) {
                Assert-CloudOpsSdkFields $pack @('id','version','file','sha256'); Assert-CloudOpsSdkId $pack.id; Assert-CloudOpsSdkVersion $pack.version
                Assert-CloudOpsSdkCondition ($pack.file -is [string] -and $pack.file.Length -le 128 -and $pack.file -cmatch '^[a-z0-9]+(?:-[a-z0-9]+)*\.json$')
                Assert-CloudOpsSdkCondition ($pack.sha256 -is [string] -and $pack.sha256 -cmatch '^[a-f0-9]{64}$')
                Assert-CloudOpsSdkCondition ($registeredPacks.Add($pack.id + '@' + $pack.version))
            }
        }
        'Plan' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','packId','controlPackVersion','controlIds','collectorIds','requiredPermissions')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.assessment-plan.v1'); Assert-CloudOpsSdkId $v.packId; Assert-CloudOpsSdkVersion $v.controlPackVersion
            Assert-CloudOpsSdkIds $v.controlIds 1000 -Control; Assert-CloudOpsSdkCondition ($v.controlIds.Count -gt 0)
            Assert-CloudOpsSdkIds $v.collectorIds 100; Assert-CloudOpsSdkArray $v.requiredPermissions 32
            $seenPermissions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($permission in $v.requiredPermissions) { Assert-CloudOpsSdkCondition ($permission -is [string] -and $permission.Length -ge 1 -and $permission.Length -le 100 -and $seenPermissions.Add($permission)) }
        }
        'Context' {
            Assert-CloudOpsSdkFields $v @('assessmentId','assessmentVersion','sdkVersion','assessmentTimestamp','capabilities','dataSource')
            Assert-CloudOpsSdkId $v.assessmentId; Assert-CloudOpsSdkVersion $v.assessmentVersion; Assert-CloudOpsSdkEnum $v.sdkVersion @('cloudops.assessment-sdk.v1')
            Assert-CloudOpsSdkTimestamp $v.assessmentTimestamp; Assert-CloudOpsSdkCapabilities $v.capabilities; Assert-CloudOpsSdkEnum $v.dataSource @('SYNTHETIC','LIVE')
        }
        'CollectorResult' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','collectorId','status','requestCount','data','warnings')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.collector-result.v1'); Assert-CloudOpsSdkId $v.collectorId
            Assert-CloudOpsSdkEnum $v.status @('SUCCESS','PARTIAL','FAILED'); Assert-CloudOpsSdkInteger $v.requestCount; Assert-CloudOpsSdkFacts $v.data
            Assert-CloudOpsSdkArray $v.warnings 32
            $seenWarnings = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($warning in $v.warnings) { Assert-CloudOpsSdkCondition ($warning -is [string] -and $warning -cmatch '^[A-Z][A-Z0-9_]{0,63}$' -and $seenWarnings.Add($warning)) }
        }
        'NormalizedState' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','assessmentTimestamp','datasets','capabilities')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.normalized-state.v1'); Assert-CloudOpsSdkTimestamp $v.assessmentTimestamp; Assert-CloudOpsSdkCapabilities $v.capabilities
            $datasets = Get-CloudOpsSdkMap $v.datasets; Assert-CloudOpsSdkCondition ($datasets.PSBase.Count -le 100)
            foreach ($id in $datasets.PSBase.Keys) { Assert-CloudOpsSdkId $id; Assert-CloudOpsSdkFields $datasets[$id] @('status','facts'); Assert-CloudOpsSdkEnum $datasets[$id].status @('SUCCESS','PARTIAL','FAILED'); Assert-CloudOpsSdkFacts $datasets[$id].facts }
        }
        'Evidence' { Assert-CloudOpsSdkFields $v @('type','facts'); Assert-CloudOpsSdkId $v.type; Assert-CloudOpsSdkFacts $v.facts }
        'Signals' { Assert-CloudOpsSdkFields $v @('exposed','privileged','compensatingControl'); foreach ($key in $v.Keys) { Assert-CloudOpsSdkCondition ($v[$key] -is [bool]) } }
        'ControlResult' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','controlId','status','applicability','confidence','observed','expected','evidence','reasonCode','riskSignals')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.control-result.v1'); Assert-CloudOpsSdkId $v.controlId -Control
            Assert-CloudOpsSdkEnum $v.status @('PASS','FAIL','MANUAL','NOT_APPLICABLE','UNKNOWN','ERROR'); Assert-CloudOpsSdkEnum $v.applicability @('APPLICABLE','NOT_APPLICABLE','UNKNOWN'); Assert-CloudOpsSdkEnum $v.confidence @('HIGH','MEDIUM','LOW')
            Assert-CloudOpsSdkFacts $v.observed; Assert-CloudOpsSdkFacts $v.expected; Assert-CloudOpsSdkArray $v.evidence 32
            foreach ($evidence in $v.evidence) { Assert-CloudOpsSdkDto $evidence 'Evidence' }
            Assert-CloudOpsSdkCondition ($v.reasonCode -is [string] -and $v.reasonCode -cmatch '^[A-Z][A-Z0-9_]{0,63}$')
            Assert-CloudOpsSdkDto $v.riskSignals 'Signals'
            Assert-CloudOpsSdkCondition (($v.status -cnotin @('PASS','FAIL') -or ($v.applicability -ceq 'APPLICABLE' -and $v.evidence.Count -gt 0)) -and (($v.status -ceq 'NOT_APPLICABLE') -eq ($v.applicability -ceq 'NOT_APPLICABLE')))
        }
        'Risk' {
            Assert-CloudOpsSdkFields $v @('modelVersion','baseSeverity','severity','signals'); Assert-CloudOpsSdkEnum $v.modelVersion @('cloudops.risk.v1')
            Assert-CloudOpsSdkEnum $v.baseSeverity @('LOW','MEDIUM','HIGH','CRITICAL'); Assert-CloudOpsSdkEnum $v.severity @('LOW','MEDIUM','HIGH','CRITICAL'); Assert-CloudOpsSdkDto $v.signals 'Signals'
            $ranks = @('LOW','MEDIUM','HIGH','CRITICAL')
            $increment = [Math]::Max(0, [int]$v.signals.exposed + [int]$v.signals.privileged - [int]$v.signals.compensatingControl)
            Assert-CloudOpsSdkCondition ($v.severity -ceq $ranks[[Math]::Min(3, [Array]::IndexOf($ranks,$v.baseSeverity) + $increment)])
        }
        'Finding' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','controlId','title','area','status','applicability','evaluation','risk','observed','expected','evidence','reasonCode','recommendationId')
            Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.finding.v1'); Assert-CloudOpsSdkText $v.title; Assert-CloudOpsSdkId $v.area; Assert-CloudOpsSdkId $v.recommendationId
            Assert-CloudOpsSdkFields $v.evaluation @('type','confidence','evaluatorId','evaluatorVersion'); Assert-CloudOpsSdkEnum $v.evaluation.type @('AUTOMATED','MANUAL','HYBRID')
            if ($null -ne $v.evaluation.evaluatorId) { Assert-CloudOpsSdkId $v.evaluation.evaluatorId; Assert-CloudOpsSdkVersion $v.evaluation.evaluatorVersion } else { Assert-CloudOpsSdkCondition ($null -eq $v.evaluation.evaluatorVersion) }
            if ($v.evaluation.type -ceq 'AUTOMATED') { Assert-CloudOpsSdkCondition ($null -ne $v.evaluation.evaluatorId -and $null -ne $v.evaluation.evaluatorVersion) }
            else { Assert-CloudOpsSdkCondition ($v.status -ceq 'MANUAL' -and $null -eq $v.evaluation.evaluatorId -and $null -eq $v.evaluation.evaluatorVersion) }
            Assert-CloudOpsSdkDto $v.risk 'Risk'
            Assert-CloudOpsSdkDto @{schemaVersion='cloudops.control-result.v1';controlId=$v.controlId;status=$v.status;applicability=$v.applicability;confidence=$v.evaluation.confidence;observed=$v.observed;expected=$v.expected;evidence=$v.evidence;reasonCode=$v.reasonCode;riskSignals=$v.risk.signals} 'ControlResult'
        }
        'Metadata' {
            Assert-CloudOpsSdkFields $v @('assessmentId','assessmentVersion','sdkVersion','assessmentTimestamp','framework','frameworkVersion','controlPackId','controlPackVersion','controlPackHash','evaluatorVersions','dataSource')
            foreach ($key in @('assessmentId','framework','controlPackId')) { Assert-CloudOpsSdkId $v[$key] }
            foreach ($key in @('assessmentVersion','controlPackVersion')) { Assert-CloudOpsSdkVersion $v[$key] }
            Assert-CloudOpsSdkEnum $v.sdkVersion @('cloudops.assessment-sdk.v1'); Assert-CloudOpsSdkTimestamp $v.assessmentTimestamp; Assert-CloudOpsSdkText $v.frameworkVersion
            Assert-CloudOpsSdkCondition ($v.controlPackHash -is [string] -and $v.controlPackHash -cmatch '^[a-f0-9]{64}$'); Assert-CloudOpsSdkEnum $v.dataSource @('SYNTHETIC','LIVE')
            $versions = Get-CloudOpsSdkMap $v.evaluatorVersions; Assert-CloudOpsSdkCondition ($versions.PSBase.Count -le 1000)
            foreach ($id in $versions.PSBase.Keys) { Assert-CloudOpsSdkId $id; Assert-CloudOpsSdkVersion $versions[$id] }
        }
        'Coverage' {
            $counts = @('totalControls','applicableControls','applicabilityUnknownControls','automatedControls','manualControls','hybridControls','manualResultControls','successfullyEvaluatedControls','passedControls','failedControls','unknownControls','errorControls','notApplicableControls')
            Assert-CloudOpsSdkFields $v ($counts + @('automationCoverage','evaluatedPassRate','evaluationCoverage'))
            foreach ($key in $counts) { Assert-CloudOpsSdkInteger $v[$key] }
            foreach ($key in @('automationCoverage','evaluatedPassRate','evaluationCoverage')) {
                $ratio = $v[$key]; Assert-CloudOpsSdkFields $ratio @('numerator','denominator','percent'); Assert-CloudOpsSdkInteger $ratio.numerator; Assert-CloudOpsSdkInteger $ratio.denominator
                Assert-CloudOpsSdkCondition ($ratio.numerator -le $ratio.denominator)
                if ($ratio.denominator -eq 0) { Assert-CloudOpsSdkCondition ($null -eq $ratio.percent) }
                else { Assert-CloudOpsSdkCondition ($ratio.percent -is [ValueType] -and $ratio.percent -isnot [bool] -and $ratio.percent -eq ([Math]::Floor($ratio.numerator/[double]$ratio.denominator*10000+0.5)/100)) }
            }
            $success = $v.passedControls + $v.failedControls
            Assert-CloudOpsSdkCondition ($v.automatedControls+$v.manualControls+$v.hybridControls -eq $v.totalControls)
            Assert-CloudOpsSdkCondition ($success+$v.manualResultControls+$v.notApplicableControls+$v.unknownControls+$v.errorControls -eq $v.totalControls)
            Assert-CloudOpsSdkCondition ($v.applicableControls+$v.notApplicableControls+$v.applicabilityUnknownControls -eq $v.totalControls -and $v.successfullyEvaluatedControls -eq $success)
            Assert-CloudOpsSdkCondition ($v.automationCoverage.numerator -eq $v.automatedControls -and $v.automationCoverage.denominator -eq $v.totalControls)
            Assert-CloudOpsSdkCondition ($v.evaluatedPassRate.numerator -eq $v.passedControls -and $v.evaluatedPassRate.denominator -eq $success)
            Assert-CloudOpsSdkCondition ($v.evaluationCoverage.numerator -eq $success -and $v.evaluationCoverage.denominator -eq $v.totalControls-$v.notApplicableControls)
        }
        'AssessmentResult' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','metadata','coverage','findings'); Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.assessment-result.v1')
            Assert-CloudOpsSdkDto $v.metadata 'Metadata'; Assert-CloudOpsSdkDto $v.coverage 'Coverage'; Assert-CloudOpsSdkArray $v.findings 1000
            foreach ($finding in $v.findings) { Assert-CloudOpsSdkDto $finding 'Finding' }
            Assert-CloudOpsSdkFindingsCoverage $v.findings $v.coverage
            Assert-CloudOpsSdkProvenance $v.findings $v.metadata
        }
        'AiInput' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','findings'); Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.ai-input.v1'); Assert-CloudOpsSdkArray $v.findings 1000
            foreach ($finding in $v.findings) {
                Assert-CloudOpsSdkFields $finding @('controlId','status','severity','facts'); Assert-CloudOpsSdkId $finding.controlId -Control
                Assert-CloudOpsSdkEnum $finding.status @('PASS','FAIL','MANUAL','NOT_APPLICABLE','UNKNOWN','ERROR'); Assert-CloudOpsSdkEnum $finding.severity @('LOW','MEDIUM','HIGH','CRITICAL'); Assert-CloudOpsSdkFacts $finding.facts
                foreach ($key in $finding.facts.PSBase.Keys) { Assert-CloudOpsSdkCondition ($null -ne $finding.facts[$key]) }
            }
        }
        'AiAdvisory' {
            Assert-CloudOpsSdkFields $v @('executiveNarrative','technicalExplanation','riskContext','crossFindingCorrelations','remediationPriority','roadmapSuggestions')
            foreach ($key in @('executiveNarrative','technicalExplanation','riskContext')) { Assert-CloudOpsSdkAdvisoryText $v[$key] }
            foreach ($key in @('crossFindingCorrelations','remediationPriority','roadmapSuggestions')) { Assert-CloudOpsSdkArray $v[$key] 32; foreach ($text in $v[$key]) { Assert-CloudOpsSdkAdvisoryText $text } }
        }
        'AiEnrichment' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','status','advisory'); Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.ai-enrichment.v1'); Assert-CloudOpsSdkEnum $v.status @('NOT_REQUESTED','AVAILABLE','UNAVAILABLE')
            if ($v.status -ceq 'AVAILABLE') { Assert-CloudOpsSdkDto $v.advisory 'AiAdvisory' } else { Assert-CloudOpsSdkCondition ($null -eq $v.advisory) }
        }
        'ReportModel' {
            Assert-CloudOpsSdkFields $v @('schemaVersion','metadata','summary','coverage','domainPosture','findings','manualControls','limitations','recommendations','aiEnrichment'); Assert-CloudOpsSdkEnum $v.schemaVersion @('cloudops.assessment-report.v1')
            Assert-CloudOpsSdkDto $v.metadata 'Metadata'; Assert-CloudOpsSdkDto $v.coverage 'Coverage'; Assert-CloudOpsSdkDto $v.aiEnrichment 'AiEnrichment'
            Assert-CloudOpsSdkFields $v.summary @('criticalFindings','highFindings','mediumFindings','lowFindings'); foreach ($key in $v.summary.Keys) { Assert-CloudOpsSdkInteger $v.summary[$key] 0 1000 }
            Assert-CloudOpsSdkArray $v.findings 1000; foreach ($finding in $v.findings) { Assert-CloudOpsSdkDto $finding 'Finding' }
            Assert-CloudOpsSdkIds $v.manualControls 1000 -Control; Assert-CloudOpsSdkTexts $v.limitations 32 500
            Assert-CloudOpsSdkArray $v.recommendations 1000; foreach ($recommendation in $v.recommendations) { Assert-CloudOpsSdkDto $recommendation 'Recommendation' }
            Assert-CloudOpsSdkArray $v.domainPosture 32
            foreach ($domain in $v.domainPosture) {
                Assert-CloudOpsSdkFields $domain @('area','passed','failed','manual','unknown','error','notApplicable'); Assert-CloudOpsSdkId $domain.area
                foreach ($key in @('passed','failed','manual','unknown','error','notApplicable')) { Assert-CloudOpsSdkInteger $domain[$key] 0 1000 }
            }
            Assert-CloudOpsSdkFindingsCoverage $v.findings $v.coverage
            Assert-CloudOpsSdkProvenance $v.findings $v.metadata
            $manualIds = @($v.findings | Where-Object { $_.status -ceq 'MANUAL' } | ForEach-Object { $_.controlId })
            Assert-CloudOpsSdkCondition ($manualIds.Count -eq $v.manualControls.Count)
            foreach ($id in $manualIds) { Assert-CloudOpsSdkCondition ($id -cin $v.manualControls) }
            foreach ($severity in @('CRITICAL','HIGH','MEDIUM','LOW')) {
                $actualCount = @($v.findings | Where-Object { $_.status -ceq 'FAIL' -and $_.risk.severity -ceq $severity }).Count
                Assert-CloudOpsSdkCondition ($v.summary[$severity.ToLowerInvariant()+'Findings'] -eq $actualCount)
            }
            $expectedDomains = @{}
            $neededRecommendations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($finding in $v.findings) {
                if (-not $expectedDomains.Contains($finding.area)) { $expectedDomains[$finding.area]=@{passed=0;failed=0;manual=0;unknown=0;error=0;notApplicable=0} }
                $statusKey = switch -CaseSensitive ($finding.status) { 'PASS' {'passed'}; 'FAIL' {'failed'}; 'MANUAL' {'manual'}; 'UNKNOWN' {'unknown'}; 'ERROR' {'error'}; 'NOT_APPLICABLE' {'notApplicable'} }
                $expectedDomains[$finding.area][$statusKey]++
                [void]$neededRecommendations.Add($finding.recommendationId)
            }
            $seenAreas = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($domain in $v.domainPosture) {
                Assert-CloudOpsSdkCondition ($seenAreas.Add($domain.area) -and $expectedDomains.Contains($domain.area))
                foreach ($key in $expectedDomains[$domain.area].Keys) { Assert-CloudOpsSdkCondition ($domain[$key] -eq $expectedDomains[$domain.area][$key]) }
            }
            Assert-CloudOpsSdkCondition ($seenAreas.Count -eq $expectedDomains.PSBase.Count)
            $seenRecommendations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
            foreach ($recommendation in $v.recommendations) { Assert-CloudOpsSdkCondition ($seenRecommendations.Add($recommendation.recommendationId) -and $neededRecommendations.Contains($recommendation.recommendationId)) }
            Assert-CloudOpsSdkCondition ($seenRecommendations.Count -eq $neededRecommendations.Count)
        }
        default { throw [System.ArgumentException]::new('Unknown Assessment SDK contract.') }
    }
}
function Assert-CloudOpsSdkProvenance {
    param([AllowEmptyCollection()] [object[]] $Findings, [object] $Metadata)
    $expected = [System.Collections.Generic.Dictionary[string,string]]::new([System.StringComparer]::Ordinal)
    foreach ($finding in $Findings) {
        if ($finding.evaluation.type -cne 'AUTOMATED') { continue }
        $id = $finding.evaluation.evaluatorId; $version = $finding.evaluation.evaluatorVersion
        if ($expected.ContainsKey($id)) { Assert-CloudOpsSdkCondition ($expected[$id] -ceq $version) } else { $expected.Add($id,$version) }
    }
    Assert-CloudOpsSdkCondition ($expected.PSBase.Count -eq $Metadata.evaluatorVersions.PSBase.Count)
    foreach ($id in $expected.PSBase.Keys) { Assert-CloudOpsSdkCondition ($Metadata.evaluatorVersions.Contains($id) -and $Metadata.evaluatorVersions[$id] -ceq $expected[$id]) }
}
function Assert-CloudOpsSdkAdvisoryText {
    param([object] $Value)
    Assert-CloudOpsSdkCondition ($Value -is [string] -and $Value.Length -ge 1 -and $Value.Length -le 2000 -and $Value -notmatch '[<>\p{Cc}\p{Cf}]')
}
function Assert-CloudOpsSdkFindingsCoverage {
    param([AllowEmptyCollection()] [object[]] $Findings, [object] $Coverage)
    $expected = @{totalControls=$Findings.Count;applicableControls=0;applicabilityUnknownControls=0;automatedControls=0;manualControls=0;hybridControls=0;manualResultControls=0;successfullyEvaluatedControls=0;passedControls=0;failedControls=0;unknownControls=0;errorControls=0;notApplicableControls=0}
    $ids = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($finding in $Findings) {
        Assert-CloudOpsSdkCondition ($ids.Add($finding.controlId))
        switch -CaseSensitive ($finding.applicability) { 'APPLICABLE' {$expected.applicableControls++}; 'UNKNOWN' {$expected.applicabilityUnknownControls++} }
        switch -CaseSensitive ($finding.evaluation.type) { 'AUTOMATED' {$expected.automatedControls++}; 'MANUAL' {$expected.manualControls++}; 'HYBRID' {$expected.hybridControls++} }
        switch -CaseSensitive ($finding.status) { 'PASS' {$expected.passedControls++;$expected.successfullyEvaluatedControls++}; 'FAIL' {$expected.failedControls++;$expected.successfullyEvaluatedControls++}; 'MANUAL' {$expected.manualResultControls++}; 'UNKNOWN' {$expected.unknownControls++}; 'ERROR' {$expected.errorControls++}; 'NOT_APPLICABLE' {$expected.notApplicableControls++} }
    }
    foreach ($key in $expected.Keys) { Assert-CloudOpsSdkCondition ($Coverage[$key] -eq $expected[$key]) }
}
function Copy-CloudOpsSdkDto {
    param([Parameter(Mandatory)] [object] $Value, [Parameter(Mandatory)] [string] $Kind)
    Assert-CloudOpsSdkDto $Value $Kind
    return Copy-CloudOpsSdkValue $Value
}
function Copy-CloudOpsSdkValue {
    param([AllowNull()] [object] $Value)
    # Validation has already limited this tree to bounded DTO values. A direct
    # clone preserves UTC strings (JSON parsers may convert them to DateTime).
    if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) { return $Value }
    if ($Value -is [array]) { return ,@(foreach ($item in $Value) { Copy-CloudOpsSdkValue $item }) }
    $map = Get-CloudOpsSdkMap $Value
    $copy = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    foreach ($key in $map.PSBase.Keys) { $copy[$key] = Copy-CloudOpsSdkValue $map[$key] }
    return $copy
}
function Get-CloudOpsSdkSortedIds {
    param([AllowEmptyCollection()] [string[]] $Ids)
    $values = [string[]] @($Ids)
    [Array]::Sort($values, [System.StringComparer]::Ordinal)
    return ,$values
}
Export-ModuleMember -Function @('Assert-CloudOpsSdkCondition','Get-CloudOpsSdkMap','Assert-CloudOpsSdkFields','Assert-CloudOpsSdkText','Assert-CloudOpsSdkId','Assert-CloudOpsSdkInteger','Assert-CloudOpsSdkEnum','Assert-CloudOpsSdkVersion','Assert-CloudOpsSdkArray','Assert-CloudOpsSdkIds','Assert-CloudOpsSdkFacts','Assert-CloudOpsSdkCapabilities','Assert-CloudOpsSdkTimestamp','Assert-CloudOpsSdkTexts','Assert-CloudOpsSdkDto','Copy-CloudOpsSdkDto','Get-CloudOpsSdkSortedIds')
