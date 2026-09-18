#requires -Version 7.2
param([switch] $EmitPreview)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Wave1Fixture.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/report/Wave1Report.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/ExecutiveSummary.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
$checks=0
function Check($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}
$fixture=New-IdentityWave1ReportFixture
$report=$fixture.outcome.reportModel
$html=New-IdentityWave1ReportHtml $report $fixture.catalog $fixture.metadata
$csv=New-IdentityWave1FindingsCsv $report $fixture.catalog
$controls=New-IdentityWave1ControlsCsv $report $fixture.catalog
Check ($report.summary.criticalFindings -eq 0 -and $report.summary.highFindings -eq 4 -and $report.summary.mediumFindings -eq 2 -and $report.summary.lowFindings -eq 1) 'Risk fixture counts'
Check ($html.IndexOf("data-severity='HIGH'") -lt $html.IndexOf("data-severity='MEDIUM'") -and $html.IndexOf("data-severity='MEDIUM'") -lt $html.IndexOf("data-severity='LOW'")) 'Severity ordering'
Check (([regex]::Matches($html,"class='findings-table'")).Count -eq 3) 'Separate severity tables'
foreach($heading in @('Controle Avaliado','Gap','Descrição do Gap','Recomendação')){Check (([regex]::Matches($html,"<th scope='col'>$heading</th>")).Count -eq 3) 'Exact finding columns'}
Check ($html.Contains('allowedToCreateApps = true') -and $html.Contains('expected = false')) 'Evaluator evidence rendered'
Check ($html.Contains('&lt;canary&gt;') -and -not $html.Contains('<canary>')) 'HTML encoded metadata'
Check ($html.Contains('@media print') -and $html.Contains('@media(max-width:520px)')) 'Print and responsive stylesheet'
Check ($html.Contains('Resumo executivo gerado sem enriquecimento de IA.')) 'Deterministic fallback'
Check (-not $html.Contains('<script') -and -not $html.Contains('https://')) 'Offline report'
Check (($csv -split "`r`n").Count -eq 9 -and ($controls -split "`r`n").Count -eq 12) 'Only gaps in findings, all selected controls in controls'
Check ($csv.StartsWith('ControlId,Title,Area,Status,Severity,Confidence,Gap,GapDescription,RecommendationId')) 'CSV projection'
$inputDto=ConvertTo-IdentityExecutiveSummaryInput $report $fixture.catalog E3_L2
$inputJson=$inputDto|ConvertTo-Json -Depth 16 -Compress
Check ($inputJson -notmatch 'tenantId|tenantName|11111111|canary|accessToken|allowedToCreateApps') 'AI input excludes tenant data and policy facts'
foreach($f in $inputDto.findings){Check ($f.facts.Count -eq 0) 'Empty fact allowlist'}
$ai=@{executiveSummary='Narrativa sintética <script>text</script>';keyRiskThemes=@('Tema sintético');priorityNarrative='Prioridade consultiva';managementConclusion='Revisão humana'}
$aiHtml=New-IdentityWave1ReportHtml $report $fixture.catalog $fixture.metadata $ai
Check ($aiHtml.Contains("data-mode='AI_ENRICHED'") -and $aiHtml.Contains('&lt;script&gt;text&lt;/script&gt;')) 'Valid AI is encoded narrative only'
$ai.status='PASS'
Check ((New-IdentityWave1ExecutiveSummary $report $ai).mode -ceq 'DETERMINISTIC') 'Forbidden authoritative field rejected'
foreach($bad in @($null,@{},@{executiveSummary='x';keyRiskThemes='not array';priorityNarrative='x';managementConclusion='x'})){
    Check ((New-IdentityWave1ExecutiveSummary $report $bad).mode -ceq 'DETERMINISTIC') 'Malformed AI fallback'
}
$stream=New-IdentityWave1Archive $report $fixture.catalog $fixture.metadata
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
try {
    Check (($zip.Entries.FullName -join ',') -ceq 'report.html,findings.csv,controls.csv,metadata.json') 'Exact ZIP entries in RAM'
    foreach($entry in $zip.Entries){
        $reader=[IO.StreamReader]::new($entry.Open())
        try{$content=$reader.ReadToEnd()}finally{$reader.Dispose()}
        Check ($content.Length -gt 0 -and $content -notmatch 'accessToken|Authorization:') 'No secrets in ZIP'
    }
} finally{$zip.Dispose();$buffer=$stream.GetBuffer();[Array]::Clear($buffer,0,$buffer.Length);$stream.Dispose()}
# Status separation must also work for future MANUAL and inconclusive controls.
$findings=(Copy-CloudOpsSdkDto $report 'ReportModel').findings
$findings[0].status='UNKNOWN';$findings[0].applicability='UNKNOWN'
$findings[1].status='ERROR';$findings[1].applicability='UNKNOWN'
$findings[2].status='MANUAL';$findings[2].applicability='UNKNOWN'
$result=New-CloudOpsAssessmentResult $report.metadata $findings
$other=New-CloudOpsAssessmentReportModel $result $report.recommendations $report.aiEnrichment $report.limitations
$otherHtml=New-IdentityWave1ReportHtml $other $fixture.catalog $fixture.metadata
Check ($otherHtml.Contains('Não foi possível concluir automaticamente') -and $otherHtml.Contains('Validação manual necessária')) 'Inconclusive and manual separate'
if($EmitPreview){@{html=$html;aiInput=$inputDto;reportModel=$fixture.outcome.reportModel} | ConvertTo-Json -Depth 24 -Compress;exit 0}
Write-Output "Wave 1 report validation passed: $checks checks; RAM-only ZIP and synthetic AI."
