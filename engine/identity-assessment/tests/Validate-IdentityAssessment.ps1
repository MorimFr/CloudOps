#requires -Version 7.2
[CmdletBinding()]
param([switch] $EmitPreview)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

trap {
    [Console]::Error.WriteLine(('FAIL: Identity synthetic validation at {0}: {1}' -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.Message))
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}

$pluginRoot = Split-Path -Parent $PSScriptRoot
$engineRoot = Split-Path -Parent $pluginRoot
Import-Module (Join-Path $engineRoot 'shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $pluginRoot 'src/IdentityAssessment.psm1') -DisableNameChecking
Import-Module (Join-Path $pluginRoot 'src/report/Report.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'DevelopmentFixture.psm1') -DisableNameChecking

$script:assertions = 0
function Assert-Condition {
    param([bool] $Condition, [string] $Message)
    $script:assertions++
    if (-not $Condition) { throw [System.InvalidOperationException]::new($Message) }
}
function Get-CanonicalJson {
    param([AllowNull()] [object] $Value)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = foreach ($key in @($Value.PSBase.Keys | Sort-Object -CaseSensitive)) {
            (ConvertTo-Json ([string] $key) -Compress) + ':' + (Get-CanonicalJson $Value[$key])
        }
        return '{' + ($parts -join ',') + '}'
    }
    if ($Value -is [array]) { return '[' + ((@($Value | ForEach-Object { Get-CanonicalJson $_ })) -join ',') + ']' }
    return ConvertTo-Json $Value -Compress
}
function Get-SourceSnapshot {
    $files = Get-ChildItem -LiteralPath $engineRoot -File -Recurse | Sort-Object FullName
    return ($files | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n"
}

$before = if ($EmitPreview) { '' } else { Get-SourceSnapshot }
$fixture = New-IdentityDevelopmentFixture
$outcome = Invoke-IdentityDevelopmentAssessment @fixture
Assert-Condition (($outcome.result.findings.status -join ',') -ceq 'PASS,FAIL,MANUAL') 'Baseline must contain PASS, FAIL and MANUAL.'
Assert-Condition ($fixture.CollectorContext.calls.users -eq 1 -and $fixture.CollectorContext.calls.capability -eq 1 -and $fixture.CollectorContext.calls.live -eq 0) 'Collectors were not deduplicated or a live collector was invoked.'
Assert-Condition ($outcome.result.coverage.totalControls -eq 3 -and $outcome.result.coverage.manualResultControls -eq 1) 'Coverage lost a control.'
Assert-Condition ($outcome.result.coverage.evaluatedPassRate.percent -eq 50 -and $outcome.result.coverage.evaluationCoverage.percent -eq 66.67) 'Coverage denominators are incorrect.'
Assert-Condition ($outcome.result.findings[1].risk.baseSeverity -ceq 'MEDIUM' -and $outcome.result.findings[1].risk.severity -ceq 'HIGH') 'Risk does not preserve its deterministic base severity.'
Assert-Condition ($outcome.result.findings[1].evidence[0].facts.pendingGuests -eq 1) 'Structured evidence was lost.'

$alternateFixture = New-IdentityDevelopmentFixture
$alternate = Invoke-IdentityDevelopmentAssessment @alternateFixture -ControlPackId 'cloudops-identity-alternate-dev'
Assert-Condition (($alternate.result.findings.status -join ',') -ceq 'PASS,PASS,MANUAL') 'Alternate pack did not reuse evaluators with different parameters.'
Assert-Condition ($alternate.result.metadata.framework -ceq 'cloudops-alternate-development' -and $alternate.result.metadata.frameworkVersion -ceq '2.0') 'Alternate framework provenance was lost.'
Assert-Condition ($alternate.result.metadata.controlPackHash -cne $outcome.result.metadata.controlPackHash) 'Separate pack hashes were not preserved.'

$archiveStream = New-IdentityAssessmentArchive $outcome.reportModel
$zip = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
$artifacts = @{}
try {
    Assert-Condition ((@($zip.Entries.FullName | Sort-Object) -join ',') -ceq 'controls.csv,findings.csv,metadata.json,report.html') 'ZIP must contain exactly four approved artifacts.'
    foreach ($entry in $zip.Entries) {
        $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8)
        try { $artifacts[$entry.FullName] = $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
} finally {
    $zip.Dispose()
    $buffer = $archiveStream.GetBuffer()
    [Array]::Clear($buffer, 0, $buffer.Length)
    $archiveStream.Dispose()
}
Assert-Condition ($artifacts['findings.csv'].Split("`r`n")[0] -ceq 'ControlId,Area,Status,Severity,Confidence,Title,RecommendationId') 'Findings CSV columns changed.'
Assert-Condition ($artifacts['controls.csv'].Split("`r`n")[0] -ceq 'ControlId,Area,EvaluationType,Status') 'Controls CSV columns changed.'
Assert-Condition (@(ConvertFrom-Csv $artifacts['findings.csv']).Count -eq 3 -and @(ConvertFrom-Csv $artifacts['controls.csv']).Count -eq 3) 'CSV omitted non-failure results.'
Assert-Condition ((Get-CanonicalJson (ConvertFrom-Json $artifacts['metadata.json'] -AsHashtable)) -ceq (Get-CanonicalJson $outcome.result.metadata)) 'Archive provenance differs from deterministic results.'
Assert-Condition ($artifacts['report.html'] -match 'SYNTHETIC DATA' -and $artifacts['report.html'] -match 'NOT CIS') 'Synthetic warning is missing.'
Assert-Condition ($artifacts['report.html'] -notmatch '<(?:script|iframe|img|link|form)\b|https?://|userPrincipalName|accessToken|tenantId') 'Report contains a forbidden external asset or sensitive field.'

if ($EmitPreview) {
    @{ html = $artifacts['report.html']; findingsCsv = $artifacts['findings.csv']; controlsCsv = $artifacts['controls.csv']; metadata = $outcome.result.metadata; result = $outcome.result; reportModel = $outcome.reportModel } | ConvertTo-Json -Depth 64 -Compress
    exit 0
}

# Each development evaluator has exact, independent PASS/FAIL/applicability/
# missing-data/technical-error fixtures, not only aggregate end-to-end assertions.
Import-Module (Join-Path $pluginRoot 'src/evaluators/Development.psm1') -DisableNameChecking
$loadedPack = Get-IdentityDevelopmentControlPack
$implementations = Get-IdentityDevelopmentEvaluatorRegistry
foreach ($index in @(0, 1)) {
    $control = $loadedPack.pack.controls[$index]
    $isMember = $index -eq 0
    foreach ($status in @('PASS', 'FAIL', 'NOT_APPLICABLE', 'UNKNOWN', 'ERROR')) {
        $scenario = switch ($status) { 'NOT_APPLICABLE' { 'not-applicable' }; 'UNKNOWN' { 'unknown' }; 'ERROR' { 'failed' }; default { 'baseline' } }
        $caseFixture = New-IdentityDevelopmentFixture -Scenario $scenario
        if ($status -eq 'FAIL' -and $isMember) { $caseFixture.CollectorContext.users.data.disabledMembers = 1 }
        if ($status -eq 'PASS' -and -not $isMember) { $caseFixture.CollectorContext.users.data.pendingGuests = 0 }
        $state = New-CloudOpsNormalizedState @($caseFixture.CollectorContext.users, $caseFixture.CollectorContext.capability) $caseFixture.Context
        $actual = Invoke-CloudOpsEvaluation $control $state $caseFixture.Context $implementations[$control.evaluator]
        $facts = $caseFixture.CollectorContext.users.data
        $observed = if ($isMember) { @{ members = $facts.members; disabledMembers = $facts.disabledMembers } } else { @{ guests = $facts.guests; pendingGuests = $facts.pendingGuests } }
        $expectedFacts = if ($isMember) { @{ maximumDisabledMembers = 0 } } else { @{ maximumPendingGuests = 0 } }
        $prefix = if ($isMember) { 'SYNTHETIC_MEMBER_CONDITION' } else { 'SYNTHETIC_GUEST_CONDITION' }
        $reason = switch ($status) {
            'PASS' { $prefix + '_MET' }
            'FAIL' { $prefix + '_NOT_MET' }
            'NOT_APPLICABLE' { $prefix + '_NOT_APPLICABLE' }
            'UNKNOWN' { if ($isMember) { 'SYNTHETIC_CAPABILITY_UNKNOWN' } else { 'SYNTHETIC_GUEST_DATA_INSUFFICIENT' } }
            'ERROR' { 'COLLECTOR_FAILED' }
        }
        $expected = @{
            schemaVersion = 'cloudops.control-result.v1'; controlId = $control.id; status = $status
            applicability = $(if ($status -in @('UNKNOWN', 'ERROR')) { 'UNKNOWN' } elseif ($status -eq 'NOT_APPLICABLE') { 'NOT_APPLICABLE' } else { 'APPLICABLE' })
            confidence = $(if ($status -in @('UNKNOWN', 'ERROR')) { 'LOW' } else { 'HIGH' })
            observed = $(if ($status -eq 'ERROR') { @{} } else { $observed })
            expected = $(if ($status -eq 'ERROR') { @{} } else { $expectedFacts })
            evidence = $(if ($status -eq 'ERROR') { @() } else { @(@{ type = 'inventory-summary'; facts = $observed }) })
            reasonCode = $reason
            riskSignals = @{ exposed = (-not $isMember -and $status -eq 'FAIL'); privileged = $false; compensatingControl = $false }
        }
        # Preserve singleton/empty evidence arrays across PowerShell subexpressions.
        $expected.evidence = if ($status -eq 'ERROR') { ,@() } else { ,@(@{ type = 'inventory-summary'; facts = $observed }) }
        Assert-Condition ((Get-CanonicalJson $actual) -ceq (Get-CanonicalJson $expected)) ('Exact control result differs: ' + $control.evaluator + ' / ' + $status)
    }
}

foreach ($case in @(
    @{ scenario = 'not-applicable'; statuses = 'NOT_APPLICABLE,NOT_APPLICABLE,MANUAL' },
    @{ scenario = 'unknown'; statuses = 'UNKNOWN,UNKNOWN,MANUAL' },
    @{ scenario = 'partial'; statuses = 'UNKNOWN,UNKNOWN,MANUAL' },
    @{ scenario = 'failed'; statuses = 'ERROR,ERROR,MANUAL' },
    @{ scenario = 'missing-facts'; statuses = 'UNKNOWN,UNKNOWN,MANUAL' }
)) {
    $caseFixture = New-IdentityDevelopmentFixture -Scenario $case.scenario
    $caseOutcome = Invoke-IdentityDevelopmentAssessment @caseFixture
    Assert-Condition (($caseOutcome.result.findings.status -join ',') -ceq $case.statuses) ('Unexpected statuses for synthetic scenario: ' + $case.scenario)
    Assert-Condition ($caseOutcome.result.coverage.failedControls -eq 0) 'Insufficient collection data was converted to FAIL.'
}

$canonical = Get-CanonicalJson $outcome.result
for ($iteration = 0; $iteration -lt 100; $iteration++) {
    $repeatFixture = New-IdentityDevelopmentFixture
    $repeat = Invoke-IdentityDevelopmentAssessment @repeatFixture
    Assert-Condition ((Get-CanonicalJson $repeat.result) -ceq $canonical) 'Same fixture and timestamp produced a different assessment result.'
}

$aiFixture = New-IdentityDevelopmentFixture
$withoutAi = Invoke-IdentityDevelopmentAssessment @aiFixture -AiProvider { param($AiInput) throw 'Synthetic provider unavailable.' }
Assert-Condition ($withoutAi.reportModel.aiEnrichment.status -ceq 'UNAVAILABLE') 'Unavailable AI did not degrade to an advisory-only state.'
Assert-Condition ((Get-CanonicalJson $withoutAi.result) -ceq $canonical) 'AI unavailability changed deterministic results.'
$null = New-IdentityAssessmentHtml $withoutAi.reportModel

foreach ($aiScenario in @('available', 'unavailable')) {
    $aiFixture = New-IdentityDevelopmentFixture
    $provider = Get-IdentityDevelopmentAiProvider -Scenario $aiScenario
    $aiOutcome = Invoke-IdentityDevelopmentAssessment @aiFixture -AiProvider $provider
    $expectedAiStatus = $aiScenario.ToUpperInvariant()
    Assert-Condition ($aiOutcome.reportModel.aiEnrichment.status -ceq $expectedAiStatus) 'The fake AI provider status was not preserved.'
    Assert-Condition ((Get-CanonicalJson $aiOutcome.result) -ceq $canonical) 'Optional AI changed authoritative results.'
    $aiStream = New-IdentityAssessmentArchive $aiOutcome.reportModel
    $aiZip = [System.IO.Compression.ZipArchive]::new($aiStream, [System.IO.Compression.ZipArchiveMode]::Read, $true)
    try {
        Assert-Condition ((@($aiZip.Entries.FullName | Sort-Object) -join ',') -ceq 'controls.csv,findings.csv,metadata.json,report.html') 'AI changed the approved archive entry set.'
        foreach ($entryName in @('metadata.json', 'report.html', 'findings.csv', 'controls.csv')) {
            $reader = [System.IO.StreamReader]::new($aiZip.GetEntry($entryName).Open(), [System.Text.Encoding]::UTF8)
            try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
            if ($entryName -ceq 'report.html') {
                Assert-Condition ($content.Contains('Enrichment status: ' + $expectedAiStatus)) 'Archive HTML omitted the advisory availability state.'
                if ($aiScenario -ceq 'available') {
                    Assert-Condition ($content.Contains('Synthetic advisory generated only by the development fixture.')) 'Archive HTML omitted the valid fake advisory.'
                }
            } elseif ($entryName -ceq 'metadata.json') {
                Assert-Condition ((Get-CanonicalJson (ConvertFrom-CloudOpsSdkJson -Json $content)) -ceq (Get-CanonicalJson $outcome.result.metadata)) 'AI changed archive provenance.'
            } else {
                Assert-Condition ($content -ceq $artifacts[$entryName]) 'AI changed the authoritative CSV artifact.'
            }
            $content = $null
        }
    } finally {
        $aiZip.Dispose()
        $buffer = $aiStream.GetBuffer()
        [Array]::Clear($buffer, 0, $buffer.Length)
        $aiStream.Dispose()
    }
}

$csvModel = Copy-CloudOpsSdkDto $outcome.reportModel 'ReportModel'
$csvModel.findings[0].observed = @{ keys = 123; count = 200000 }
$shadowHtml = New-IdentityAssessmentHtml $csvModel
Assert-Condition ($shadowHtml.Contains('<dt>keys</dt><dd>123</dd>') -and $shadowHtml.Contains('<dt>count</dt><dd>200000</dd>')) 'Dictionary member names hid report facts.'
$csvModel.findings[0].title = '=1+1'
Assert-Condition ((New-IdentityFindingsCsv $csvModel) -match '"''=1\+1"') 'CSV formula injection was not neutralized.'
$csvModel.findings[0].title = 'DEV: A & B "quoted"'
Assert-Condition ((New-IdentityAssessmentHtml $csvModel) -match 'DEV: A &amp; B &quot;quoted&quot;') 'HTML text was not encoded.'
$csvModel.findings[0].title = '<script>not-a-real-script()</script>'
$rejected = $false
try { $null = New-IdentityAssessmentHtml $csvModel } catch { $rejected = $true }
Assert-Condition $rejected 'HTML-bearing DTO was accepted.'

$manifest = ConvertFrom-Json ([System.IO.File]::ReadAllText((Join-Path $pluginRoot 'assessment.json'))) -AsHashtable
Assert-Condition ($manifest.enabled -and $manifest.auth.provider -ceq 'microsoft-graph' -and ($manifest.auth.permissions -join ',') -ceq 'GroupSettings.Read.All,Policy.Read.All') 'Wave 1 lab enablement or permission gate changed.'
$liveFixture = New-IdentityDevelopmentFixture
$liveFixture.Context.dataSource = 'LIVE'
$rejected = $false
try { $null = Invoke-IdentityDevelopmentAssessment @liveFixture } catch { $rejected = $true }
Assert-Condition $rejected 'Synthetic development harness accepted live context.'

& (Join-Path $PSScriptRoot 'Validate-UsersCollector.ps1')
Assert-Condition ((Get-SourceSnapshot) -ceq $before) 'Engine files changed during in-memory assessment tests.'
[Console]::WriteLine(('PASS: Identity assessment: {0} assertions; two DEV packs; 100 deterministic runs; exact RAM ZIP; safe HTML/CSV; AI fallback; no tenant calls or engine writes.' -f $script:assertions))
