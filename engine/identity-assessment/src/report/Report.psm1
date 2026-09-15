Set-StrictMode -Version Latest

$sharedDirectory = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'shared'
Import-Module (Join-Path $sharedDirectory 'assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'normalization/IdentityState.psm1') -DisableNameChecking

function ConvertTo-IdentityReportText {
    param([AllowNull()] [object] $Value)
    return [System.Net.WebUtility]::HtmlEncode([string] $Value)
}

function ConvertTo-IdentityCsvCell {
    param([AllowNull()] [object] $Value)
    $text = [string] $Value
    # Quoting alone does not stop spreadsheet formula execution.
    if ($text -match '^\s*[=+\-@]' -or $text -match '^[\t\r\n]') { $text = "'" + $text }
    return '"' + $text.Replace('"', '""') + '"'
}

function New-IdentityFindingsCsv {
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $ReportModel)
    Assert-CloudOpsSdkDto -Kind ReportModel -Value $ReportModel
    $text = [System.Text.StringBuilder]::new()
    [void] $text.Append("ControlId,Area,Status,Severity,Confidence,Title,RecommendationId`r`n")
    foreach ($finding in $ReportModel.findings) {
        $values = @($finding.controlId, $finding.area, $finding.status, $finding.risk.severity, $finding.evaluation.confidence, $finding.title, $finding.recommendationId)
        [void] $text.Append((($values | ForEach-Object { ConvertTo-IdentityCsvCell $_ }) -join ','))
        [void] $text.Append("`r`n")
    }
    return $text.ToString()
}

function New-IdentityControlsCsv {
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $ReportModel)
    Assert-CloudOpsSdkDto -Kind ReportModel -Value $ReportModel
    $text = [System.Text.StringBuilder]::new()
    [void] $text.Append("ControlId,Area,EvaluationType,Status`r`n")
    foreach ($finding in $ReportModel.findings) {
        $values = @($finding.controlId, $finding.area, $finding.evaluation.type, $finding.status)
        [void] $text.Append((($values | ForEach-Object { ConvertTo-IdentityCsvCell $_ }) -join ','))
        [void] $text.Append("`r`n")
    }
    return $text.ToString()
}

function New-IdentityFactsHtml {
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $Facts)
    $rows = [System.Text.StringBuilder]::new()
    foreach ($key in @($Facts.PSBase.Keys | Sort-Object -CaseSensitive)) {
        $value = if ($null -eq $Facts[$key]) { 'Unknown' } elseif ($Facts[$key] -is [bool]) { if ($Facts[$key]) { 'true' } else { 'false' } } else { [string] $Facts[$key] }
        [void] $rows.Append("<div><dt>$(ConvertTo-IdentityReportText $key)</dt><dd>$(ConvertTo-IdentityReportText $value)</dd></div>")
    }
    if ($rows.Length -eq 0) { return '<p class="muted">No sufficient structured facts recorded.</p>' }
    return "<dl class='facts'>$rows</dl>"
}

function Get-IdentityRateLabel {
    param([System.Collections.IDictionary] $Rate)
    if ($null -eq $Rate.percent) { return 'Not defined (no eligible controls)' }
    return ([double] $Rate.percent).ToString('0.##', [cultureinfo]::InvariantCulture) + '%'
}

function New-IdentityStatusChart {
    param([System.Collections.IDictionary] $Coverage)
    $segments = @(
        @{ label = 'PASS'; value = $Coverage.passedControls; color = '#16824b' },
        @{ label = 'FAIL'; value = $Coverage.failedControls; color = '#dc3545' },
        @{ label = 'MANUAL / HYBRID'; value = $Coverage.manualResultControls; color = '#946a08' },
        @{ label = 'NOT_APPLICABLE'; value = $Coverage.notApplicableControls; color = '#668294' },
        @{ label = 'UNKNOWN'; value = $Coverage.unknownControls; color = '#6c63b5' },
        @{ label = 'ERROR'; value = $Coverage.errorControls; color = '#b84a16' }
    )
    $circles = [System.Text.StringBuilder]::new()
    $legend = [System.Text.StringBuilder]::new()
    $offset = 0.0
    foreach ($segment in $segments) {
        $fraction = if ($Coverage.totalControls -gt 0) { 100.0 * $segment.value / $Coverage.totalControls } else { 0.0 }
        $width = $fraction.ToString('0.######', [cultureinfo]::InvariantCulture)
        $gap = (100.0 - $fraction).ToString('0.######', [cultureinfo]::InvariantCulture)
        $start = (-$offset).ToString('0.######', [cultureinfo]::InvariantCulture)
        if ($segment.value -gt 0) { [void] $circles.Append("<circle cx='60' cy='60' r='43' pathLength='100' fill='none' stroke='$($segment.color)' stroke-width='20' stroke-dasharray='$width $gap' stroke-dashoffset='$start' transform='rotate(-90 60 60)'/>") }
        [void] $legend.Append("<li><span><i style='background:$($segment.color)'></i>$(ConvertTo-IdentityReportText $segment.label)</span><strong>$($segment.value)</strong></li>")
        $offset += $fraction
    }
    return "<div class='chart'><svg viewBox='0 0 120 120' role='img' aria-labelledby='status-chart-title'><title id='status-chart-title'>Control result distribution; counts in adjacent legend</title><circle cx='60' cy='60' r='43' fill='none' stroke='#e4eaf1' stroke-width='20'/>$circles<text x='60' y='60' text-anchor='middle' fill='#18243b' font-size='18' font-weight='700'>$($Coverage.totalControls)</text><text x='60' y='76' text-anchor='middle' fill='#52637b' font-size='9'>CONTROLS</text></svg><ul class='legend'>$legend</ul></div>"
}

function New-IdentityAssessmentHtml {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $ReportModel)

    Assert-CloudOpsSdkDto -Kind ReportModel -Value $ReportModel

    $metadata = $ReportModel.metadata
    $coverage = $ReportModel.coverage
    $synthetic = $metadata.dataSource -ceq 'SYNTHETIC'
    $banner = if ($synthetic) { '<aside class="development-warning" role="note"><strong>DEVELOPMENT · SYNTHETIC DATA · NOT CIS</strong><p>This report validates the SDK only. It does not assess your tenant, demonstrate compliance, or authorize changes to real accounts.</p></aside>' } else { '' }
    $metadataRows = [System.Text.StringBuilder]::new()
    foreach ($key in @('assessmentId', 'assessmentVersion', 'sdkVersion', 'assessmentTimestamp', 'framework', 'frameworkVersion', 'controlPackId', 'controlPackVersion', 'controlPackHash', 'dataSource')) {
        [void] $metadataRows.Append("<div><dt>$(ConvertTo-IdentityReportText $key)</dt><dd>$(ConvertTo-IdentityReportText $metadata[$key])</dd></div>")
    }
    foreach ($key in @($metadata.evaluatorVersions.PSBase.Keys | Sort-Object -CaseSensitive)) {
        [void] $metadataRows.Append("<div><dt>Evaluator: $(ConvertTo-IdentityReportText $key)</dt><dd>$(ConvertTo-IdentityReportText $metadata.evaluatorVersions[$key])</dd></div>")
    }
    $coverageRows = [System.Text.StringBuilder]::new()
    foreach ($key in @('totalControls', 'applicableControls', 'applicabilityUnknownControls', 'automatedControls', 'manualControls', 'hybridControls', 'manualResultControls', 'successfullyEvaluatedControls', 'passedControls', 'failedControls', 'unknownControls', 'errorControls', 'notApplicableControls')) {
        [void] $coverageRows.Append("<tr><th scope='row'>$(ConvertTo-IdentityReportText $key)</th><td>$($coverage[$key])</td></tr>")
    }
    $areaCards = [System.Text.StringBuilder]::new()
    foreach ($area in Get-IdentityAreaDefinitions) {
        $posture = @($ReportModel.domainPosture | Where-Object { $_.area -ceq $area.id })
        $detail = if ($posture.Count -eq 0) { '<p class="muted">Not evaluated by this control pack. No security conclusion is available.</p>' } else {
            $p = $posture[0]
            "<p><strong>PASS $($p.passed)</strong> · FAIL $($p.failed) · MANUAL $($p.manual)</p><p class='muted'>UNKNOWN $($p.unknown) · ERROR $($p.error) · NOT_APPLICABLE $($p.notApplicable)</p>"
        }
        [void] $areaCards.Append("<article class='area-card'><h3>$(ConvertTo-IdentityReportText $area.name)</h3>$detail</article>")
    }
    $findingRows = [System.Text.StringBuilder]::new()
    $evidenceCards = [System.Text.StringBuilder]::new()
    $criticalCards = [System.Text.StringBuilder]::new()
    $manualCards = [System.Text.StringBuilder]::new()
    foreach ($finding in $ReportModel.findings) {
        $id = ConvertTo-IdentityReportText $finding.controlId
        $title = ConvertTo-IdentityReportText $finding.title
        $status = ConvertTo-IdentityReportText $finding.status
        $severity = ConvertTo-IdentityReportText $finding.risk.severity
        [void] $findingRows.Append("<tr><th scope='row'><span class='control-id'>$id</span>$title</th><td>$(ConvertTo-IdentityReportText $finding.area)</td><td><span class='status'>$status</span></td><td>$severity<br><small>Base: $(ConvertTo-IdentityReportText $finding.risk.baseSeverity)</small></td><td>$(ConvertTo-IdentityReportText $finding.evaluation.confidence)</td></tr>")
        if ($finding.status -ceq 'FAIL' -and $finding.risk.severity -cin @('HIGH', 'CRITICAL')) {
            [void] $criticalCards.Append("<article class='finding-highlight'><strong>$severity · $id</strong><h3>$title</h3><p>$(ConvertTo-IdentityReportText $finding.reasonCode)</p></article>")
        }
        if ($finding.status -ceq 'MANUAL') { [void] $manualCards.Append("<li><strong>$id</strong> — $title. Human validation required; no automated verdict.</li>") }
        $evidenceItems = [System.Text.StringBuilder]::new()
        foreach ($item in $finding.evidence) { [void] $evidenceItems.Append("<h4>$(ConvertTo-IdentityReportText $item.type)</h4>$(New-IdentityFactsHtml $item.facts)") }
        [void] $evidenceCards.Append("<article class='evidence-card'><h3>$id · $status</h3><p>$(ConvertTo-IdentityReportText $finding.reasonCode)</p><div class='evidence-columns'><section><h4>Observed</h4>$(New-IdentityFactsHtml $finding.observed)</section><section><h4>Expected</h4>$(New-IdentityFactsHtml $finding.expected)</section></div><h4>Structured evidence</h4>$evidenceItems</article>")
    }
    if ($criticalCards.Length -eq 0) { [void] $criticalCards.Append('<p class="muted">No high or critical FAIL findings in this result. This is not proof that unassessed areas are secure.</p>') }
    if ($manualCards.Length -eq 0) { [void] $manualCards.Append('<li>No controls require manual validation in this pack.</li>') }
    $recommendationCards = [System.Text.StringBuilder]::new()
    foreach ($recommendation in $ReportModel.recommendations) {
        $steps = ($recommendation.technicalSteps | ForEach-Object { '<li>' + (ConvertTo-IdentityReportText $_) + '</li>' }) -join ''
        $rollback = ($recommendation.rollback | ForEach-Object { '<li>' + (ConvertTo-IdentityReportText $_) + '</li>' }) -join ''
        $validation = ($recommendation.validation | ForEach-Object { '<li>' + (ConvertTo-IdentityReportText $_) + '</li>' }) -join ''
        $portal = if ($recommendation.portalPath.Count -gt 0) { '<p>Portal: ' + (($recommendation.portalPath | ForEach-Object { ConvertTo-IdentityReportText $_ }) -join ' → ') + '</p>' } else { '<p class="muted">No portal operation is defined for this synthetic exercise.</p>' }
        [void] $recommendationCards.Append("<article class='recommendation'><p class='eyebrow'>$(ConvertTo-IdentityReportText $recommendation.recommendationId)</p><h3>$(ConvertTo-IdentityReportText $recommendation.title)</h3><p>$(ConvertTo-IdentityReportText $recommendation.summary)</p>$portal<ol>$steps</ol><p><strong>Impact:</strong> $(ConvertTo-IdentityReportText $recommendation.impact)</p><h4>Rollback</h4><ul>$rollback</ul><h4>Validation</h4><ul>$validation</ul></article>")
    }
    $limitations = ($ReportModel.limitations | ForEach-Object { '<li>' + (ConvertTo-IdentityReportText $_) + '</li>' }) -join ''
    $advisory = '<p class="muted">No AI narrative is available. Deterministic results and report generation are unaffected.</p>'
    if ($ReportModel.aiEnrichment.status -ceq 'AVAILABLE') {
        $advisoryParts = [System.Text.StringBuilder]::new()
        foreach ($key in @('executiveNarrative', 'technicalExplanation', 'riskContext')) {
            [void] $advisoryParts.Append("<h3>$(ConvertTo-IdentityReportText $key)</h3><p>$(ConvertTo-IdentityReportText $ReportModel.aiEnrichment.advisory[$key])</p>")
        }
        foreach ($key in @('crossFindingCorrelations', 'remediationPriority', 'roadmapSuggestions')) {
            $items = ($ReportModel.aiEnrichment.advisory[$key] | ForEach-Object { '<li>' + (ConvertTo-IdentityReportText $_) + '</li>' }) -join ''
            [void] $advisoryParts.Append("<h3>$(ConvertTo-IdentityReportText $key)</h3><ul>$items</ul>")
        }
        $advisory = $advisoryParts.ToString()
    }
    $passRate = Get-IdentityRateLabel $coverage.evaluatedPassRate
    $automation = Get-IdentityRateLabel $coverage.automationCoverage
    $evaluation = Get-IdentityRateLabel $coverage.evaluationCoverage
    return @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>CloudOps · Identity Assessment</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#18243b;font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:28px}h1,h2,h3,h4,p{margin-top:0}h1{font-size:clamp(32px,4.4vw,54px);line-height:1.12;margin-bottom:18px}h2{font-size:24px;line-height:1.3;margin-bottom:20px}h3{font-size:17px;line-height:1.4}h4{font-size:14px;margin:18px 0 8px}section{margin:30px 0}.hero{padding:36px;border-radius:22px;background:linear-gradient(118deg,#10223e,#254b8e 65%,#086d91);color:#fff}.hero p{color:#dceaff;max-width:870px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;overflow-wrap:anywhere}.pill{display:inline-block;border:1px solid #b8d6f252;background:#ffffff0d;border-radius:20px;padding:7px 13px;font-size:12px;margin:4px 8px 0 0;overflow-wrap:anywhere}.development-warning{margin-top:20px;padding:20px 24px;border:1px solid #e2ba55;border-left:5px solid #c18900;border-radius:14px;background:#fff7da;color:#634306}.development-warning p{margin:5px 0 0}.metrics,.two-column,.areas,.evidence-columns{display:grid;gap:16px}.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.metric,.panel,.area-card,.evidence-card,.recommendation{min-width:0;border:1px solid #dbe4f1;border-radius:16px;background:white;padding:23px}.metric{border-top:4px solid #336abb}.metric strong{display:block;font-size:32px;line-height:1.25;margin:10px 0}.metric p,.muted{font-size:13px;color:#52637b}.metric p{margin:0}.two-column,.evidence-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.areas{grid-template-columns:repeat(3,minmax(0,1fr))}.area-card p:last-child{margin-bottom:0}.chart{display:flex;align-items:center;gap:28px}.chart svg{width:190px;max-width:42%;flex:none}.legend{list-style:none;flex:1;padding:0;margin:0}.legend li{display:flex;justify-content:space-between;gap:12px;margin:11px 0;font-size:13px}.legend span{display:flex;align-items:center;gap:9px}.legend i{width:9px;height:9px;border-radius:50%;flex:none}.metadata,.facts{margin:0}.metadata>div,.facts>div{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,2fr);gap:15px;padding:9px 0;border-bottom:1px solid #edf1f6}.metadata dt,.facts dt{font-size:13px;color:#52637b}.metadata dd,.facts dd{margin:0;overflow-wrap:anywhere}.metadata dd{font-family:ui-monospace,Consolas,monospace;font-size:12px}.facts dd{font-weight:650}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th,td{border-bottom:1px solid #e3eaf4;padding:12px;vertical-align:top;overflow-wrap:anywhere}thead th{background:#edf3fc}th[scope=row]{font-weight:600}.table-scroll{overflow-x:auto}.findings-table{min-width:650px}.control-id{display:block;font:11px/1.7 ui-monospace,Consolas,monospace;color:#52637b}.status{font-size:11px;font-weight:750;background:#edf2f8;border-radius:5px;padding:4px 7px;display:inline-block}.finding-highlight{padding:18px 22px;background:#fff2ef;border-left:4px solid #cb4838;border-radius:12px;margin-bottom:12px}.finding-highlight p{margin-bottom:0}.evidence-card,.recommendation{margin-bottom:16px}.evidence-columns section{margin:0}.recommendation li{margin-bottom:6px}.advisory{border-style:dashed;border-color:#7b81b4}footer{font-size:12px;color:#52637b;padding:24px 0;border-top:1px solid #dbe4f1}.rate{padding:13px 0;border-bottom:1px solid #edf1f6}.rate strong{display:block;font-size:21px}.rate span{font-size:13px;color:#52637b}code{overflow-wrap:anywhere}@media(max-width:1000px){.metrics,.areas{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){main{padding:14px}.hero{padding:25px 20px}.metrics,.two-column,.areas,.evidence-columns{grid-template-columns:1fr}.metric,.panel,.area-card,.evidence-card,.recommendation{padding:18px}.metadata>div,.facts>div{grid-template-columns:1fr;gap:2px}.chart{gap:15px}.chart svg{width:135px}.legend li{font-size:11px}h2{font-size:21px}}@media print{body{background:white;font-size:11px}main{max-width:none;padding:0}.hero{padding:24px;border-radius:0;background:#163c68!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.development-warning{-webkit-print-color-adjust:exact;print-color-adjust:exact}.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.two-column,.evidence-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.areas{grid-template-columns:repeat(3,minmax(0,1fr))}.metric,.panel,.area-card,.evidence-card,.recommendation{padding:14px;box-shadow:none;break-inside:avoid}section{margin:22px 0}h2,h3,h4{break-after:avoid}.table-scroll{overflow:visible}.findings-table{min-width:0;table-layout:fixed;font-size:9px}th,td{padding:7px}tr{break-inside:avoid}thead{display:table-header-group}.chart svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}.metric strong{font-size:24px}footer{break-inside:avoid}}
</style></head><body><main>
<header class="hero"><p class="eyebrow">CloudOps · Assessment SDK</p><h1>Identity Assessment</h1><p>Deterministic findings, structured evidence and transparent coverage. Framework conformity and CloudOps risk are reported separately.</p><span class="pill">$(ConvertTo-IdentityReportText $metadata.controlPackId) · $(ConvertTo-IdentityReportText $metadata.controlPackVersion)</span><span class="pill">$(ConvertTo-IdentityReportText $metadata.assessmentTimestamp)</span><span class="pill">$(ConvertTo-IdentityReportText $metadata.dataSource)</span></header>
$banner
<section aria-labelledby="executive-title"><h2 id="executive-title">Executive Summary</h2><div class="metrics"><article class="metric"><h3>Controls in scope</h3><strong>$($coverage.totalControls)</strong><p>$($coverage.applicableControls) applicable · $($coverage.applicabilityUnknownControls) applicability unknown</p></article><article class="metric"><h3>Evaluated controls</h3><strong>$($coverage.successfullyEvaluatedControls)</strong><p>Only PASS + FAIL have a conclusive automated verdict.</p></article><article class="metric"><h3>PASS / FAIL</h3><strong>$($coverage.passedControls) / $($coverage.failedControls)</strong><p>Pass rate: $passRate · denominator $($coverage.evaluatedPassRate.denominator)</p></article><article class="metric"><h3>High / critical findings</h3><strong>$($ReportModel.summary.highFindings) / $($ReportModel.summary.criticalFindings)</strong><p>Deterministic CloudOps risk, counted only for FAIL results.</p></article></div></section>
<section aria-labelledby="coverage-title"><h2 id="coverage-title">Coverage</h2><div class="two-column"><article class="panel"><h3>Control result distribution</h3>$(New-IdentityStatusChart $coverage)</article><article class="panel"><h3>Coverage is not conformity</h3><div class="rate"><strong>Automation coverage: $automation</strong><span>$($coverage.automationCoverage.numerator) automated definitions / $($coverage.automationCoverage.denominator) total controls</span></div><div class="rate"><strong>Evaluation coverage: $evaluation</strong><span>$($coverage.evaluationCoverage.numerator) conclusive results / $($coverage.evaluationCoverage.denominator) controls not marked NOT_APPLICABLE</span></div><div class="rate"><strong>Evaluated pass rate: $passRate</strong><span>$($coverage.evaluatedPassRate.numerator) PASS / $($coverage.evaluatedPassRate.denominator) PASS + FAIL. UNKNOWN, ERROR and MANUAL are not failures.</span></div></article></div><div class="panel" style="margin-top:16px"><table class="coverage-table"><caption class="muted">Exact counters and denominators</caption><tbody>$coverageRows</tbody></table></div></section>
<section aria-labelledby="posture-title"><h2 id="posture-title">Identity Posture Overview</h2><div class="areas">$areaCards</div></section>
<section aria-labelledby="critical-title"><h2 id="critical-title">Critical Findings</h2>$criticalCards</section>
<section aria-labelledby="findings-title"><h2 id="findings-title">All Findings</h2><div class="panel table-scroll"><table class="findings-table"><thead><tr><th scope="col">Control</th><th scope="col">Area</th><th scope="col">Status</th><th scope="col">CloudOps risk</th><th scope="col">Confidence</th></tr></thead><tbody>$findingRows</tbody></table></div></section>
<section aria-labelledby="manual-title"><h2 id="manual-title">Manual Validation Required</h2><div class="panel"><ul>$manualCards</ul></div></section>
<section aria-labelledby="roadmap-title"><h2 id="roadmap-title">Remediation Roadmap</h2><p class="muted">Recommendations are versioned, deterministic catalog entries. Review applicability and impact before any real environment change; development entries are test instructions only.</p>$recommendationCards</section>
<section aria-labelledby="ai-title"><h2 id="ai-title">Optional AI Advisory</h2><div class="panel advisory"><p><strong>Enrichment status: $(ConvertTo-IdentityReportText $ReportModel.aiEnrichment.status)</strong></p><p class="muted">Advisory only. AI cannot change status, applicability, evidence, base severity or control pack versions.</p>$advisory</div></section>
<section aria-labelledby="methodology-title"><h2 id="methodology-title">Methodology</h2><div class="panel"><p>Validated control pack → deduplicated collectors → normalized aggregate state → isolated deterministic evaluators → structured evidence → findings → deterministic risk → optional advisory → report.</p><p>Collector failure is never converted to FAIL. Missing or partial data produces UNKNOWN or ERROR. MANUAL and HYBRID controls require human validation. UNAVAILABLE capability does not imply non-conformity.</p><p>A single assessment timestamp is supplied to every evaluator. No tenant identifiers, raw responses, tokens or individual account records are included in these artifacts.</p></div></section>
<section aria-labelledby="limitations-title"><h2 id="limitations-title">Limitations</h2><div class="panel"><ul>$limitations</ul></div></section>
<section aria-labelledby="evidence-title"><h2 id="evidence-title">Technical Evidence Summary</h2>$evidenceCards</section>
<section aria-labelledby="metadata-title"><h2 id="metadata-title">Assessment Metadata</h2><div class="panel"><dl class="metadata">$metadataRows</dl></div></section>
<footer>CloudOps · Offline report · No analytics, remote assets or external scripts. The downloaded artifact is retained only by its recipient. $(if ($synthetic) { 'SYNTHETIC DEVELOPMENT OUTPUT — NOT A TENANT ASSESSMENT.' })</footer>
</main></body></html>
"@
}

function New-IdentityAssessmentArchive {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [System.Collections.IDictionary] $ReportModel)

    Assert-CloudOpsSdkDto -Kind ReportModel -Value $ReportModel
    $memory = [System.IO.MemoryStream]::new()
    $archive = $null
    try {
        $archive = [System.IO.Compression.ZipArchive]::new($memory, [System.IO.Compression.ZipArchiveMode]::Create, $true)
        foreach ($entryName in @('report.html', 'findings.csv', 'controls.csv', 'metadata.json')) {
            $content = switch ($entryName) {
                'report.html' { New-IdentityAssessmentHtml $ReportModel }
                'findings.csv' { New-IdentityFindingsCsv $ReportModel }
                'controls.csv' { New-IdentityControlsCsv $ReportModel }
                'metadata.json' { $ReportModel.metadata | ConvertTo-Json -Depth 16 }
            }
            $entryStream = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal).Open()
            $writer = $null
            try {
                $writer = [System.IO.StreamWriter]::new($entryStream, [System.Text.UTF8Encoding]::new($false), 4096, $false)
                $writer.Write($content)
            } finally {
                if ($null -ne $writer) { $writer.Dispose() } else { $entryStream.Dispose() }
                $content = $null
            }
        }
        $archive.Dispose()
        $archive = $null
        $memory.Position = 0
        return $memory
    } catch {
        if ($null -ne $archive) { $archive.Dispose() }
        $buffer = $memory.GetBuffer()
        [Array]::Clear($buffer, 0, $buffer.Length)
        $memory.Dispose()
        throw [System.InvalidOperationException]::new('Identity report could not be generated safely.')
    }
}

Export-ModuleMember -Function New-IdentityAssessmentHtml, New-IdentityFindingsCsv, New-IdentityControlsCsv, New-IdentityAssessmentArchive, ConvertTo-IdentityCsvCell
