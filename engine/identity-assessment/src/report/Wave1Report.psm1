Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../../../shared/CloudOps.Report.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking

function Get-IdentityWave1FactsText {
    param([System.Collections.IDictionary] $Facts)
    return (@(foreach($key in @($Facts.Keys | Sort-Object -CaseSensitive)) {
        $value=if($null -eq $Facts[$key]){'desconhecido'}elseif($Facts[$key] -is [bool]){([string]$Facts[$key]).ToLowerInvariant()}else{[string]$Facts[$key]}
        $key+' = '+$value
    }) -join '; ')
}
function New-IdentityWave1FindingProjection {
    param([object] $Finding,[System.Collections.IDictionary] $Catalog,[object[]] $Recommendations)
    $entry=$Catalog[$Finding.controlId]
    if($null -eq $entry){throw 'Unregistered report control.'}
    $recommendation=@($Recommendations | Where-Object {$_.recommendationId -ceq $Finding.recommendationId})
    if($recommendation.Count -ne 1){throw 'Unregistered recommendation.'}
    $evidence=(@($Finding.evidence | ForEach-Object { $_.type+': '+(Get-IdentityWave1FactsText $_.facts) }) -join ' | ')
    $description=$entry.description+' Observado: '+(Get-IdentityWave1FactsText $Finding.observed)+'. Evidência: '+$evidence+'. Estado esperado: '+(Get-IdentityWave1FactsText $Finding.expected)+'.'
    return @{controlEvaluated=$entry.cisId+' — '+$Finding.title;cisId=$entry.cisId;gap=$(if($Finding.status -ceq 'FAIL'){$entry.gap}else{''});gapDescription=$(if($Finding.status -ceq 'FAIL'){$description}else{''});recommendation=$recommendation[0].summary+' Portal: '+($recommendation[0].portalPath -join ' → ');finding=$Finding}
}
function Test-IdentityExecutiveSummary {
    param([AllowNull()] [object] $Value)
    try {
        $map=Get-CloudOpsSdkMap $Value
        if($map.Count -ne 4 -or @($map.Keys | Where-Object {$_ -cnotin @('executiveSummary','keyRiskThemes','priorityNarrative','managementConclusion')}).Count -ne 0){return $false}
        if($map.keyRiskThemes -isnot [array] -or $map.keyRiskThemes.Count -gt 6){return $false}
        foreach($text in @($map.executiveSummary,$map.priorityNarrative,$map.managementConclusion)+$map.keyRiskThemes){
            if($text -isnot [string] -or $text.Trim().Length -eq 0 -or $text.Length -gt 2500 -or $text -match '[\p{Cc}\p{Cf}]' -or $text -match '\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b'){return $false}
        }
        return $true
    } catch { return $false }
}
function New-IdentityWave1ExecutiveSummary {
    param([System.Collections.IDictionary] $ReportModel,[AllowNull()] [object] $AiExecutiveSummary)
    if(Test-IdentityExecutiveSummary $AiExecutiveSummary){return @{mode='AI_ENRICHED';content=(Get-CloudOpsSdkMap $AiExecutiveSummary)}}
    $c=$ReportModel.coverage;$s=$ReportModel.summary
    return @{mode='DETERMINISTIC';content=@{
        executiveSummary="A avaliação parcial analisou $($c.totalControls) controles selecionados da Wave 1: $($c.passedControls) conformes e $($c.failedControls) gaps confirmados. Somente PASS e FAIL contam como conclusões automáticas."
        keyRiskThemes=@("Distribuição dos gaps pelo Risk Engine: $($s.criticalFindings) críticos, $($s.highFindings) altos, $($s.mediumFindings) médios e $($s.lowFindings) baixos.")
        priorityNarrative='Priorizar os gaps críticos e altos, validar o impacto e aprovar as ações determinísticas indicadas nas tabelas. Ausência de gap não comprova segurança de áreas não avaliadas.'
        managementConclusion="Revisar $($c.manualResultControls) resultados manuais e $($c.unknownControls + $c.errorControls) resultados inconclusivos. A cobertura é limitada à Wave 1 e não constitui certificação CIS."
    }}
}
function New-IdentityWave1FindingsCsv {
    param([System.Collections.IDictionary] $ReportModel,[System.Collections.IDictionary] $Catalog)
    Assert-CloudOpsSdkDto $ReportModel 'ReportModel'
    $lines=[Collections.Generic.List[string]]::new()
    $lines.Add('ControlId,Title,Area,Status,Severity,Confidence,Gap,GapDescription,RecommendationId')
    foreach($f in $ReportModel.findings){
        if($f.status -cne 'FAIL'){continue}
        $p=New-IdentityWave1FindingProjection $f $Catalog $ReportModel.recommendations
        $values=@($p.cisId,$f.title,$f.area,$f.status,$f.risk.severity,$f.evaluation.confidence,$p.gap,$p.gapDescription,$f.recommendationId)
        $lines.Add((($values | ForEach-Object {ConvertTo-CloudOpsReportCsvCell $_}) -join ','))
    }
    return ($lines -join "`r`n")+"`r`n"
}
function New-IdentityWave1ControlsCsv {
    param([System.Collections.IDictionary] $ReportModel,[System.Collections.IDictionary] $Catalog)
    $lines=[Collections.Generic.List[string]]::new();$lines.Add('ControlId,Title,Area,Status,Severity,Confidence,ReasonCode,Observed,Expected,RecommendationId')
    foreach($f in $ReportModel.findings){
        $values=@($Catalog[$f.controlId].cisId,$f.title,$f.area,$f.status,$f.risk.severity,$f.evaluation.confidence,$f.reasonCode,(Get-IdentityWave1FactsText $f.observed),(Get-IdentityWave1FactsText $f.expected),$f.recommendationId)
        $lines.Add((($values | ForEach-Object {ConvertTo-CloudOpsReportCsvCell $_}) -join ','))
    }
    return ($lines -join "`r`n")+"`r`n"
}
function New-IdentityWave1ReportHtml {
    param([System.Collections.IDictionary] $ReportModel,[System.Collections.IDictionary] $Catalog,[System.Collections.IDictionary] $MetadataContext,[AllowNull()] [object] $AiExecutiveSummary)
    Assert-CloudOpsSdkDto $ReportModel 'ReportModel'
    $m=$ReportModel.metadata;$c=$ReportModel.coverage;$s=$ReportModel.summary
    $summary=New-IdentityWave1ExecutiveSummary $ReportModel $AiExecutiveSummary
    $body=[Text.StringBuilder]::new()
    $cards=@(
        (New-CloudOpsReportMetric 'Controles avaliados' $c.successfullyEvaluatedControls "$($c.totalControls) selecionados · apenas PASS + FAIL")
        (New-CloudOpsReportMetric 'Conformes' $c.passedControls 'Conclusões PASS' 'pass')
        (New-CloudOpsReportMetric 'Gaps' $c.failedControls 'Somente FAIL com evidência' 'high')
        (New-CloudOpsReportMetric 'Críticos' $s.criticalFindings 'Risk Engine · CRITICAL' 'critical')
        (New-CloudOpsReportMetric 'Altos' $s.highFindings 'Risk Engine · HIGH' 'high')
        (New-CloudOpsReportMetric 'Médios' $s.mediumFindings 'Risk Engine · MEDIUM' 'medium')
        (New-CloudOpsReportMetric 'Baixos' $s.lowFindings 'Risk Engine · LOW' 'low')
        (New-CloudOpsReportMetric 'Manual / Não avaliados' ($c.manualResultControls+$c.unknownControls+$c.errorControls) "$($c.notApplicableControls) não aplicáveis, separados deste total")
    ) -join ''
    [void]$body.Append("<section><h2>Resumo executivo</h2><div class='metrics'>$cards</div></section><section class='panel executive-summary' data-mode='$($summary.mode)'><h2>Leitura do ambiente</h2>")
    if($summary.mode -ceq 'DETERMINISTIC'){[void]$body.Append('<p class="muted">Resumo executivo gerado sem enriquecimento de IA.</p>')}else{[void]$body.Append('<p class="notice">Narrativa enriquecida por IA, sujeita a revisão humana. Contagens, evidências, classificações e recomendações nas tabelas permanecem autoritativas.</p>')}
    [void]$body.Append('<p>'+ (ConvertTo-CloudOpsReportText $summary.content.executiveSummary)+'</p><ul>')
    foreach($theme in $summary.content.keyRiskThemes){[void]$body.Append('<li>'+(ConvertTo-CloudOpsReportText $theme)+'</li>')}
    [void]$body.Append('</ul><p>'+(ConvertTo-CloudOpsReportText $summary.content.priorityNarrative)+'</p><p>'+(ConvertTo-CloudOpsReportText $summary.content.managementConclusion)+'</p></section>')
    $risk=@(@{label='Crítico';count=$s.criticalFindings;color='#971c5a'},@{label='Alto';count=$s.highFindings;color='#dc2626'},@{label='Médio';count=$s.mediumFindings;color='#e79000'},@{label='Baixo';count=$s.lowFindings;color='#168bba'})
    $status=@(@{label='PASS';count=$c.passedControls;color='#16a34a'},@{label='FAIL';count=$c.failedControls;color='#dc2626'},@{label='MANUAL';count=$c.manualResultControls;color='#e79000'},@{label='UNKNOWN / ERROR';count=($c.unknownControls+$c.errorControls);color='#64748b'},@{label='NOT_APPLICABLE';count=$c.notApplicableControls;color='#168bba'})
    [void]$body.Append("<section><h2>Distribuição de risco e resultados</h2><div class='two-column'><article class='panel'>$(New-CloudOpsReportDistribution $risk 'gaps confirmados')</article><article class='panel'>$(New-CloudOpsReportDistribution $status 'controles selecionados')</article></div></section>")
    $labels=@{CRITICAL='CRÍTICO';HIGH='ALTO';MEDIUM='MÉDIO';LOW='BAIXO'}
    foreach($severity in @('CRITICAL','HIGH','MEDIUM','LOW')){
        $findings=@($ReportModel.findings | Where-Object {$_.status -ceq 'FAIL' -and $_.risk.severity -ceq $severity})
        if($findings.Count -eq 0){continue}
        [void]$body.Append("<section data-severity='$severity'><h2 class='severity-heading $($severity.ToLowerInvariant())'>$($labels[$severity]) — $($findings.Count) GAPS</h2><div class='table-scroll'><table class='findings-table'><thead><tr><th scope='col'>Controle Avaliado</th><th scope='col'>Gap</th><th scope='col'>Descrição do Gap</th><th scope='col'>Recomendação</th></tr></thead><tbody>")
        foreach($f in $findings){
            $p=New-IdentityWave1FindingProjection $f $Catalog $ReportModel.recommendations
            [void]$body.Append('<tr><td>'+(ConvertTo-CloudOpsReportText $p.controlEvaluated)+'</td><td>'+(ConvertTo-CloudOpsReportText $p.gap)+'</td><td>'+(ConvertTo-CloudOpsReportText $p.gapDescription)+'</td><td>'+(ConvertTo-CloudOpsReportText $p.recommendation)+'</td></tr>')
        }
        [void]$body.Append('</tbody></table></div></section>')
    }
    foreach($group in @(@{title='Controles conformes';statuses=@('PASS');collapsed=$true},@{title='Validação manual necessária';statuses=@('MANUAL');collapsed=$false},@{title='Não foi possível concluir automaticamente';statuses=@('UNKNOWN','ERROR');collapsed=$false},@{title='Controles não aplicáveis';statuses=@('NOT_APPLICABLE');collapsed=$false})){
        $items=@($ReportModel.findings | Where-Object {$_.status -cin $group.statuses})
        [void]$body.Append('<section class="panel">')
        if($group.collapsed){[void]$body.Append('<details><summary>'+$group.title+' ('+$items.Count+')</summary>')}else{[void]$body.Append('<h2>'+$group.title+'</h2>')}
        if($items.Count -eq 0){[void]$body.Append('<p class="muted">Nenhum resultado nesta categoria.</p>')}
        [void]$body.Append('<ul class="compact-list">')
        foreach($f in $items){[void]$body.Append('<li>'+(ConvertTo-CloudOpsReportText ($Catalog[$f.controlId].cisId+' — '+$f.title+' · '+$f.status+' · '+$f.reasonCode))+'</li>')}
        [void]$body.Append('</ul>');if($group.collapsed){[void]$body.Append('</details>')};[void]$body.Append('</section>')
    }
    [void]$body.Append("<section class='panel'><h2>Cobertura da avaliação</h2><p>$($c.totalControls) controles selecionados do perfil $(ConvertTo-CloudOpsReportText $MetadataContext.profile); $($c.successfullyEvaluatedControls) conclusões automáticas. Dez controles implementados na Wave 1 de um inventário Identity planejado de 71 controles. Os outros 61 não foram executados.</p><p>Ausência no perfil não é NOT_APPLICABLE. Os resultados não representam o benchmark completo nem certificação CIS.</p></section>")
    [void]$body.Append('<section class="panel"><h2>Metodologia</h2><p>Benchmark → fatos normalizados → evaluator isolado → evidência objetiva → risco determinístico → relatório. Apenas leitura Microsoft Graph v1.0; quatro famílias compartilhadas, sem inventário individual de usuários. A coleta não é um snapshot transacional.</p><p>UNKNOWN representa evidência insuficiente; ERROR representa falha técnica. Nenhuma dessas categorias é uma vulnerabilidade confirmada. Licenciamento não é inferido a partir do perfil selecionado.</p><p>Codebooks: guestRoleCategory 1 = convidado limitado, 2 = restrito ao próprio objeto, 3 = acesso equivalente a membro. invitationPolicyCategory 1 = adminsAndGuestInviters, 2 = none, 3 = adminsGuestInvitersAndAllMembers, 4 = everyone. O CIS aceita categorias 1 ou 2 em ambos os controles.</p></section>')
    [void]$body.Append('<section class="panel"><h2>Limitações</h2><ul>')
    foreach($limitation in $ReportModel.limitations){[void]$body.Append('<li>'+(ConvertTo-CloudOpsReportText $limitation)+'</li>')}
    [void]$body.Append("</ul></section><section class='panel provenance'><h2>Benchmark e proveniência</h2><p>CIS Microsoft 365 Foundations Benchmark v7.0.0 · Pack $(ConvertTo-CloudOpsReportText $m.controlPackId) / $(ConvertTo-CloudOpsReportText $m.controlPackVersion) · SDK $(ConvertTo-CloudOpsReportText $m.sdkVersion)</p><p>Timestamp UTC: $(ConvertTo-CloudOpsReportText $m.assessmentTimestamp) · Dados: $(ConvertTo-CloudOpsReportText $m.dataSource)</p><p>Hash do pack: $(ConvertTo-CloudOpsReportText $m.controlPackHash)</p><p>Severidades são classificações CloudOps versionadas, não severidades atribuídas pelo CIS.</p></section>")
    if($m.dataSource -ceq 'SYNTHETIC'){[void]$body.Insert(0,'<p role="note" class="notice">DADOS SINTÉTICOS — não representa avaliação de um tenant real.</p>')}
    return New-CloudOpsReportDocument -Title 'Assessment de Identidade' -Eyebrow 'CloudOps · Identity Assessment' -Description 'Visão executiva e técnica da configuração de identidade. CIS Microsoft 365 Foundations 7.0.0 — Wave 1, cobertura parcial.' -MetadataPills @(
        ('Organização: '+$MetadataContext.tenantName),('Tenant ID: '+$MetadataContext.tenantId),('Capacidades: '+$MetadataContext.capabilitySummary),('Benchmark: CIS 7.0.0'),('Perfil: '+$MetadataContext.profile),('UTC: '+$m.assessmentTimestamp),('Pack: '+$m.controlPackVersion)
    ) -ContentHtml $body.ToString()
}
function New-IdentityWave1Archive {
    param([System.Collections.IDictionary] $ReportModel,[System.Collections.IDictionary] $Catalog,[System.Collections.IDictionary] $MetadataContext,[AllowNull()] [object] $AiExecutiveSummary)
    Assert-CloudOpsSdkDto $ReportModel 'ReportModel'
    $memory=[IO.MemoryStream]::new();$archive=$null
    try {
        $archive=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Create,$true)
        foreach($name in @('report.html','findings.csv','controls.csv','metadata.json')){
            $content=switch($name){
                'report.html'{New-IdentityWave1ReportHtml $ReportModel $Catalog $MetadataContext $AiExecutiveSummary}
                'findings.csv'{New-IdentityWave1FindingsCsv $ReportModel $Catalog}
                'controls.csv'{New-IdentityWave1ControlsCsv $ReportModel $Catalog}
                'metadata.json'{@{assessment=$ReportModel.metadata;profile=$MetadataContext.profile;reportStandard='cloudops.report.v1';wave=1;implementedControls=10;plannedIdentityControls=71;coverage=$ReportModel.coverage;severityCounts=$ReportModel.summary;executiveSummaryMode=(New-IdentityWave1ExecutiveSummary $ReportModel $AiExecutiveSummary).mode} | ConvertTo-Json -Depth 16}
            }
            $stream=$archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal).Open()
            $writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
            try{$writer.Write($content)}finally{$writer.Dispose();$content=$null}
        }
        $archive.Dispose();$archive=$null;$memory.Position=0
        return $memory
    } catch {
        if($null -ne $archive){$archive.Dispose()}
        $buffer=$memory.GetBuffer();[Array]::Clear($buffer,0,$buffer.Length);$memory.Dispose()
        throw [InvalidOperationException]::new('Wave 1 report generation failed safely.')
    } finally {$AiExecutiveSummary=$null}
}
Export-ModuleMember -Function New-IdentityWave1ReportHtml, New-IdentityWave1Archive, New-IdentityWave1FindingsCsv, New-IdentityWave1ControlsCsv, New-IdentityWave1ExecutiveSummary, Test-IdentityExecutiveSummary, New-IdentityWave1FindingProjection
