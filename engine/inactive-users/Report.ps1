# Static, offline report rendering. All directory-sourced text is HTML encoded.
function New-InactiveChart {
    param([string] $Id, [string] $Title, [object[]] $Items)
    $total = [long] 0
    foreach ($item in $Items) { $total += $item.Count }
    $segments = [System.Text.StringBuilder]::new()
    $legend = [System.Text.StringBuilder]::new()
    $offset = 0.0
    foreach ($item in $Items) {
        $percent = if ($total -gt 0) { 100.0 * $item.Count / $total } else { 0.0 }
        $p = $percent.ToString('0.######', [cultureinfo]::InvariantCulture)
        $gap = (100.0 - $percent).ToString('0.######', [cultureinfo]::InvariantCulture)
        $start = (-$offset).ToString('0.######', [cultureinfo]::InvariantCulture)
        if ($item.Count -gt 0) {
            [void] $segments.Append("<circle cx='60' cy='60' r='42' pathLength='100' fill='none' stroke='$($item.Color)' stroke-width='22' stroke-dasharray='$p $gap' stroke-dashoffset='$start' transform='rotate(-90 60 60)'/>")
        }
        $label = ConvertTo-CloudOpsHtmlText ([string] $item.Label)
        $value = Format-InactiveNumber $item.Count
        $percentageLabel = $percent.ToString('N1', [cultureinfo] 'pt-BR')
        [void] $legend.Append("<li><div class='legend-line'><span><i style='background:$($item.Color)'></i>$label</span><span><b>$value</b> <small>($percentageLabel%)</small></span></div><div class='track'><span style='width:$p%;background:$($item.Color)'></span></div></li>")
        $offset += $percent
    }
    $safeTitle = ConvertTo-CloudOpsHtmlText $Title
    $centerLabel = if ($total -eq 0) { '0' } else { '100%' }
    $empty = if ($total -eq 0) { '<p class="muted">Sem contas nesta população.</p>' } else { '' }
    return @"
<article class="chart card"><h3 id="$Id-title">$safeTitle</h3><p class="chart-base">Base: $(Format-InactiveNumber $total) contas · percentuais dentro deste gráfico</p><div class="chart-body"><svg viewBox="0 0 120 120" role="img" aria-labelledby="$Id-title $Id-description"><desc id="$Id-description">Distribuição detalhada na legenda adjacente.</desc><circle cx="60" cy="60" r="42" fill="none" stroke="#e2e8f0" stroke-width="22"/>$segments<text x="60" y="65" text-anchor="middle" fill="#12233e" font-size="14" font-weight="700">$centerLabel</text></svg><ul class="legend">$legend</ul></div>$empty</article>
"@
}

function Get-InactiveReasonLabel {
    param([string] $Reason)
    switch ($Reason) {
        'recorded-success' { 'Último sucesso conhecido: 90 dias ou mais' }
        'absence-and-creation' { 'Sem sucesso registrado: criação há 90 dias ou mais' }
        'historical-attempts' { 'Histórico legado: apenas tentativas antigas, sem data de sucesso' }
        'activity-not-selected' { 'Atividade não selecionada em uma coleta validada' }
        'invalid-activity-schema' { 'Estrutura de atividade incompleta ou inválida' }
        'missing-success-without-old-attempts' { 'Campo de sucesso omitido, sem tentativas antigas suficientes' }
        'missing-creation' { 'Data de criação não informada' }
        'invalid-creation' { 'Data de criação inválida' }
        'future-creation' { 'Data de criação posterior à observação' }
        'invalid-success' { 'Data de sucesso inválida' }
        'future-success' { 'Data de sucesso posterior à observação' }
        'success-before-creation' { 'Sucesso anterior à criação da conta' }
        'invalid-attempt' { 'Data de tentativa inválida' }
        'future-attempt' { 'Tentativa posterior à observação' }
        'attempt-before-creation' { 'Tentativa anterior à criação da conta' }
        'success-during-collection' { 'Login bem-sucedido observado durante a coleta' }
        'recent-attempt-without-success' { 'Tentativa recente, mas sem sucesso registrado' }
        default { 'Evidência insuficiente para classificação' }
    }
}

function New-InactiveDiagnosticRows {
    param([hashtable] $Counts, [string] $EmptyMessage)
    $rows = ($Counts.GetEnumerator() | Sort-Object @{ Expression = { $_.Value }; Descending = $true }, Name | ForEach-Object {
        "<tr><th scope='row'>$(ConvertTo-CloudOpsHtmlText (Get-InactiveReasonLabel $_.Key))</th><td>$(Format-InactiveNumber $_.Value)</td></tr>"
    }) -join ''
    if ($rows.Length -eq 0) { return "<tr><td colspan='2'>$(ConvertTo-CloudOpsHtmlText $EmptyMessage)</td></tr>" }
    return $rows
}

function New-InactiveReportHtml {
    param([hashtable] $Stats, [string] $TenantId, [string] $TenantName, [string] $ExecutionId, [DateTimeOffset] $AsOfUtc, [long] $Requests)
    $s = $Stats
    $percent = if ($s.Total -gt 0) { 100.0 * $s.Inactive / $s.Total } else { 0.0 }
    $percentLabel = $percent.ToString('N1', [cultureinfo] 'pt-BR')
    $metrics = @(
        @{ Title = 'Usuários no tenant'; Count = $s.Total; Detail = 'População única lida nesta coleta'; Color = '#64748b' }
        @{ Title = 'Usuários inativos'; Count = $s.Inactive; Detail = "$percentLabel% da população analisada"; Color = '#dc2626' }
        @{ Title = 'Inativos habilitados'; Count = $s.InactiveEnabled; Detail = 'Habilitação não comprova autorização efetiva'; Color = '#f59e0b' }
        @{ Title = 'Inativos licenciados'; Count = $s.InactiveLicensed; Detail = 'Contas com ao menos uma licença atribuída'; Color = '#16a34a' }
        @{ Title = 'Convidados'; Count = $s.Guests; Detail = "$(Format-InactiveNumber $s.InactiveGuests) classificados como inativos"; Color = '#0891b2' }
        @{ Title = 'Convites pendentes'; Count = $s.Pending; Detail = "$(Format-InactiveNumber $s.PendingInactive) convidados inativos com convite pendente"; Color = '#2563eb' }
        @{ Title = 'Inativos sem sucesso registrado'; Count = $s.NoRecordedSuccess; Detail = 'Criados há 90 dias ou mais; sem data de sucesso'; Color = '#dc2626' }
        @{ Title = 'Desabilitados e licenciados'; Count = $s.DisabledLicensed; Detail = 'Toda a população, não apenas os inativos'; Color = '#7c3aed' }
    )
    $cards = ($metrics | ForEach-Object {
        "<article class='metric card' style='border-top-color:$($_.Color)'><h3>$(ConvertTo-CloudOpsHtmlText $_.Title)</h3><strong>$(Format-InactiveNumber $_.Count)</strong><p>$(ConvertTo-CloudOpsHtmlText $_.Detail)</p></article>"
    }) -join ''
    $charts = [System.Text.StringBuilder]::new()
    [void] $charts.Append((New-InactiveChart 'population-state' 'Estado da população analisada' @(
        @{ Label = 'Ativos no período'; Count = $s.Active; Color = '#16a34a' }
        @{ Label = 'Inativos'; Count = $s.Inactive; Color = '#dc2626' }
        @{ Label = 'Período inicial sem login'; Count = $s.Initial; Color = '#f59e0b' }
        @{ Label = 'Indeterminados'; Count = $s.Indeterminate; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'account-types' 'Membros e convidados no tenant' @(
        @{ Label = 'Membros'; Count = $s.Members; Color = '#2563eb' }
        @{ Label = 'Convidados'; Count = $s.Guests; Color = '#0891b2' }
        @{ Label = 'Tipo não informado'; Count = $s.OtherTypes; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'inactive-types' 'Inativos por tipo de conta' @(
        @{ Label = 'Membros'; Count = $s.InactiveMembers; Color = '#2563eb' }
        @{ Label = 'Convidados'; Count = $s.InactiveGuests; Color = '#0891b2' }
        @{ Label = 'Tipo não informado'; Count = $s.InactiveOtherTypes; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'guest-invites' 'Situação dos convites de convidados' @(
        @{ Label = 'Convite aceito'; Count = $s.Accepted; Color = '#16a34a' }
        @{ Label = 'Convite pendente'; Count = $s.Pending; Color = '#f59e0b' }
        @{ Label = 'Estado não informado'; Count = $s.OtherGuests; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'inactive-age' 'Faixas de inatividade' @(
        @{ Label = '90 a 179 dias'; Count = $s.Days90; Color = '#f59e0b' }
        @{ Label = '180 a 364 dias'; Count = $s.Days180; Color = '#ea580c' }
        @{ Label = '365 dias ou mais'; Count = $s.Days365; Color = '#dc2626' }
        @{ Label = 'Sem sucesso registrado'; Count = $s.NoRecordedSuccess; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'inactive-enabled' 'Estado das contas inativas' @(
        @{ Label = 'Habilitadas'; Count = $s.InactiveEnabled; Color = '#dc2626' }
        @{ Label = 'Desabilitadas'; Count = $s.InactiveDisabled; Color = '#2563eb' }
        @{ Label = 'Estado não informado'; Count = $s.InactiveUnknownEnabled; Color = '#64748b' }
    )))
    [void] $charts.Append((New-InactiveChart 'inactive-licenses' 'Licenciamento dos inativos' @(
        @{ Label = 'Licenciados'; Count = $s.InactiveLicensed; Color = '#7c3aed' }
        @{ Label = 'Sem licença'; Count = $s.InactiveUnlicensed; Color = '#16a34a' }
        @{ Label = 'Não informado'; Count = $s.InactiveUnknownLicense; Color = '#64748b' }
    )))
    $licenseRows = ($s.Licenses.Values | Sort-Object @{ Expression = { $_.Inactive }; Descending = $true }, @{ Expression = { $_.Name } } | ForEach-Object {
        "<tr><th scope='row'>$(ConvertTo-CloudOpsHtmlText $_.Name)</th><td>$(Format-InactiveNumber $_.Total)</td><td>$(Format-InactiveNumber $_.Inactive)</td><td>$(Format-InactiveNumber ($_.Total - $_.Inactive))</td></tr>"
    }) -join ''
    if ($licenseRows.Length -eq 0) { $licenseRows = '<tr><td colspan="4">Nenhuma licença atribuída identificada na população lida.</td></tr>' }
    $sampleRows = ($s.Sample | ForEach-Object {
        $cells = ($_.Values | ForEach-Object { '<td>' + (ConvertTo-CloudOpsHtmlText ([string] $_)) + '</td>' }) -join ''
        "<tr>$cells</tr>"
    }) -join ''
    if ($sampleRows.Length -eq 0) { $sampleRows = '<tr><td colspan="8">Nenhuma conta classificada como inativa nesta coleta.</td></tr>' }
    $evidenceRows = New-InactiveDiagnosticRows $s.InactiveEvidence 'Nenhuma conta inativa.'
    $reasonRows = New-InactiveDiagnosticRows $s.IndeterminateReasons 'Nenhuma conta indeterminada.'
    $warningRows = New-InactiveDiagnosticRows $s.QualityWarnings 'Nenhum alerta de qualidade identificado.'
    $indeterminateRows = ($s.IndeterminateSample | ForEach-Object {
        "<tr><td>$(ConvertTo-CloudOpsHtmlText $_.Name)</td><td>$(ConvertTo-CloudOpsHtmlText $_.UPN)</td><td>$(ConvertTo-CloudOpsHtmlText (Get-InactiveReasonLabel $_.Reason))</td></tr>"
    }) -join ''
    if ($indeterminateRows.Length -eq 0) { $indeterminateRows = '<tr><td colspan="3">Nenhuma conta indeterminada.</td></tr>' }
    $historyWarning = if ($s.Total -gt 0 -and -not $s.ActivityShapes['object']) {
        '<p class="callout">Atenção: nenhuma conta retornou um objeto de atividade nesta coleta. Embora a consulta selecionada tenha concluído sem erro, a ausência generalizada de histórico exige validar cobertura, licenciamento e acesso com o administrador. Classificações por ausência são operacionais, não comprovação de que as contas nunca acessaram.</p>'
    } else { '' }
    $safeTenant = ConvertTo-CloudOpsHtmlText $TenantName
    $safeTenantId = ConvertTo-CloudOpsHtmlText $TenantId
    $safeExecutionId = ConvertTo-CloudOpsHtmlText $ExecutionId
    $reference = Format-InactiveUtc $AsOfUtc
    $cutoff = Format-InactiveUtc ($AsOfUtc.AddDays(-90))
    $generated = Format-InactiveUtc ([DateTimeOffset]::UtcNow)
    return @"
<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>CloudOps — Mapear Usuários Inativos</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#17233b;font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1540px;margin:auto;padding:24px}.hero{padding:38px;border-radius:24px;background:linear-gradient(120deg,#131d36,#203d83 67%,#006b91);color:#fff;margin-bottom:30px}.eyebrow{font-size:11px;font-weight:750;letter-spacing:.2em;color:#b6e6ff;text-transform:uppercase}h1{font-size:clamp(30px,4vw,50px);line-height:1.12;margin:14px 0}h2{font-size:23px;margin:28px 0 14px}h3{font-size:16px;margin:0 0 10px}.hero>p:not(.eyebrow){max-width:930px;color:#dce6ff;font-size:16px}.meta{display:flex;flex-wrap:wrap;gap:9px;margin-top:24px}.meta span{padding:7px 12px;border:1px solid #7890b3;border-radius:20px;background:#ffffff12;font-size:12px;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{border:1px solid #dce4f0;border-radius:18px;background:#fff;box-shadow:0 5px 18px #152c4d06}.metric{border-top:4px solid;padding:20px}.metric h3{font-size:13px;color:#495873}.metric strong{font-size:35px;line-height:1.2}.metric p{margin:7px 0 0;font-size:12px;color:#566681}.reading{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;margin-top:24px}.reading article{padding:24px}.callout{padding:18px;background:#eff6ff;border-left:4px solid #2563eb}.reading ul{padding-left:20px}.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.chart{padding:23px;break-inside:avoid}.chart-base{font-size:12px;color:#566681;margin:0 0 16px}.chart-body{display:flex;gap:22px;align-items:center}.chart svg{width:136px;min-width:100px;flex:0 0 27%;height:auto}.legend{list-style:none;padding:0;margin:0;flex:1;min-width:0}.legend li+li{margin-top:12px}.legend-line{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}.legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px}.legend small,.muted{color:#566681}.track{height:7px;background:#e2e8f0;border-radius:9px;overflow:hidden;margin-top:5px}.track span{display:block;height:100%;border-radius:inherit}.table-card{padding:22px;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}caption{text-align:left;color:#566681;padding-bottom:15px}th,td{text-align:left;padding:11px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;overflow-wrap:anywhere}thead{background:#eff4fa}tbody th{font-weight:500}.technical{padding:24px;margin:20px 0}.technical dl{display:grid;grid-template-columns:180px 1fr;gap:8px 15px}.technical dt{font-weight:700}.technical dd{margin:0;overflow-wrap:anywhere}.technical li{margin-bottom:9px}footer{margin-top:25px;color:#566681;font-size:12px}code{font-size:12px;overflow-wrap:anywhere}.sample-table{min-width:1000px}
@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.reading{grid-template-columns:1fr}.chart-body{flex-direction:column}.chart svg{width:135px}.legend{width:100%}}@media(max-width:620px){main{padding:12px}.hero{padding:25px;border-radius:18px}.grid,.chart-grid{grid-template-columns:1fr}.technical dl{grid-template-columns:1fr}.metric strong{font-size:32px}}@media print{body{background:white;font-size:11px}main{max-width:none;padding:0}.hero{border-radius:0;padding:22px;print-color-adjust:exact;-webkit-print-color-adjust:exact}.card{box-shadow:none}.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.metric{padding:10px}.metric strong{font-size:24px}.chart-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-body{flex-direction:column}.legend{width:100%}.table-card{overflow:visible}.sample-table{min-width:0;font-size:8px}.chart,.metric,tr{break-inside:avoid}thead{display:table-header-group}h2{break-after:avoid}}
</style></head><body><main>
<header class="hero"><p class="eyebrow">CloudOps · Visibilidade de segurança de identidade</p><h1>Usuários inativos</h1><p>Visão executiva do ciclo de vida de identidades, contas a revisar e licenças atribuídas no Microsoft Entra ID. Ferramenta: Mapear Usuários Inativos.</p><div class="meta"><span>Tenant: $safeTenant</span><span>Tenant ID: $safeTenantId</span><span>Referência UTC: $reference</span><span>Corte inclusivo: $cutoff</span></div></header>
<h2>Resumo executivo</h2><section class="grid" aria-label="Indicadores executivos">$cards</section>
<section class="reading"><article class="card"><h3>Leitura do ambiente</h3><div class="callout"><b>$(Format-InactiveNumber $s.Inactive) contas ($percentLabel%)</b> atendem ao critério operacional de inatividade. Destas, $(Format-InactiveNumber $s.NoRecordedSuccess) não possuem data de login bem-sucedido registrada e já completaram 90 dias desde a criação.</div><p>$(Format-InactiveNumber $s.Initial) contas estão no período inicial sem login e não entram no CSV. $(Format-InactiveNumber $s.Indeterminate) contas têm classificação indeterminada e também ficam fora do CSV.</p></article><article class="card"><h3>Indicadores de decisão</h3><ul><li><b>$(Format-InactiveNumber $s.InactiveEnabledLicensed)</b> inativos estão habilitados e licenciados: priorizar validação com os responsáveis.</li><li><b>$(Format-InactiveNumber $s.PendingInactive)</b> convidados inativos aguardam aceite: confirmar necessidade com patrocinadores.</li><li><b>$(Format-InactiveNumber $s.Days365)</b> contas têm último sucesso há pelo menos um ano.</li><li>Ausência de uso não comprova desligamento. Revisar exceções, férias, contas técnicas e contas de emergência antes de qualquer ação.</li></ul></article></section>
<h2>Gráficos e comparativos</h2><section class="chart-grid">$charts</section>
<h2>Evidências e qualidade dos dados</h2>
<section class="technical card" aria-label="Cobertura da atividade"><p>A consulta selecionou explicitamente <code>signInActivity</code> e percorreu todas as páginas sem erro. Formato retornado: <b>$(Format-InactiveNumber $s.ActivityShapes['object'])</b> objetos de atividade, <b>$(Format-InactiveNumber $s.ActivityShapes['null'])</b> valores nulos, <b>$(Format-InactiveNumber $s.ActivityShapes['omitted'])</b> propriedades omitidas e <b>$(Format-InactiveNumber $s.ActivityShapes['invalid'])</b> valores de formato inválido. Isso descreve a cobertura recebida, não valida a completude histórica do Microsoft Graph.</p>$historyWarning<p>Inatividade e força da evidência são dimensões diferentes. Apenas o último sucesso conhecido permite informar dias exatos. Ausência de registro mais idade da conta atende à regra operacional, mas não prova que a conta nunca entrou. Tentativas antigas são evidência complementar, sem identificar sucesso ou falha.</p></section>
<section class="reading"><article class="table-card card"><h3>Evidência dos inativos</h3><table class="evidence-table"><caption>Base: $(Format-InactiveNumber $s.Inactive) inativos. Categorias exclusivas; a soma corresponde ao CSV.</caption><thead><tr><th>Evidência</th><th>Contas</th></tr></thead><tbody>$evidenceRows</tbody></table></article><article class="table-card card"><h3>Por que ficaram indeterminados?</h3><table class="reason-table"><caption>Base: $(Format-InactiveNumber $s.Indeterminate) indeterminados, todos fora do CSV. Um motivo principal por conta; revisar o campo indicado no Entra e repetir a coleta após a validação.</caption><thead><tr><th>Motivo principal</th><th>Contas</th></tr></thead><tbody>$reasonRows</tbody></table></article></section>
<section class="technical card"><h3>Alertas complementares</h3><table class="warning-table"><caption>Contagens em toda a população; alertas podem se sobrepor. Criação ausente/inválida ou tentativas inválidas não anulam uma data de sucesso utilizável. Sem sucesso, dados essenciais inválidos impedem a classificação.</caption><thead><tr><th>Alerta</th><th>Contas</th></tr></thead><tbody>$warningRows</tbody></table><p>Uma tentativa recente não comprova acesso bem-sucedido: pode ser falha, automação ou atraso de atualização. Valide esses casos antes de agir. Logins bem-sucedidos durante a coleta são classificados como ativos.</p></section>
<section class="table-card card"><h3>Amostra para investigar os indeterminados</h3><table class="indeterminate-table"><caption>Primeiras $(Format-InactiveNumber $s.IndeterminateSample.Count) contas indeterminadas, limitadas a 50. Esta amostra fica somente no HTML; não é ranking nem relação completa.</caption><thead><tr><th>Nome</th><th>UPN</th><th>Motivo</th></tr></thead><tbody>$indeterminateRows</tbody></table></section>
<h2>Licenças atribuídas: oportunidade de revisão</h2><section class="table-card card"><table><caption>Uma conta pode ter várias licenças. As linhas contam vínculos por SKU, não usuários únicos nem economia financeira garantida. O SKU técnico é preservado; nomes desconhecidos não são inventados.</caption><thead><tr><th>Licença / SKU</th><th>Usuários atribuídos</th><th>Inativos</th><th>Demais usuários</th></tr></thead><tbody>$licenseRows</tbody></table><p class="muted">Licenciamento não informado: $(Format-InactiveNumber $s.UnknownLicense) contas, sendo $(Format-InactiveNumber $s.InactiveUnknownLicense) inativas. Licenças gratuitas, bundles e contratos exigem análise própria.</p></section>
<h2>Detalhamento técnico: amostra de inativos</h2><section class="table-card card"><table class="sample-table"><caption>Primeiras $(Format-InactiveNumber $s.Sample.Count) contas inativas da coleta, limitadas a 50 para manter o HTML executivo compacto. A relação completa de $(Format-InactiveNumber $s.Inactive) contas está em usuarios-inativos.csv; a amostra não representa ranking de risco.</caption><thead><tr><th>Nome</th><th>UPN</th><th>Tipo de Conta</th><th>Tipo de convidado</th><th>Dias sem login bem-sucedido</th><th>Data Criação (UTC)</th><th>Licenciado</th><th>Licença</th></tr></thead><tbody>$sampleRows</tbody></table></section>
<h2>Critérios, cobertura e limitações</h2><section class="technical card"><dl><dt>Regra com último sucesso</dt><dd><code>lastSuccessfulSignInDateTime ≤ $cutoff</code>. Dias inteiros completos, calculados contra a referência UTC fixa, sem arredondar para cima.</dd><dt>Regra sem sucesso registrado</dt><dd>Na consulta selecionada e concluída, histórico de atividade nulo/omitido ou data de sucesso explicitamente nula: criação há pelo menos 90 dias para entrar no CSV. Criação mais recente: período inicial; criação desconhecida/inválida: indeterminado.</dd><dt>Histórico legado</dt><dd>Se o objeto omite o campo de sucesso, os dois campos de tentativas devem estar presentes, com ao menos uma data e nenhuma posterior ao corte. Datas devem ser válidas e compatíveis com a criação, que também precisa ter 90 dias. Não inferimos a data de último sucesso a partir de tentativas.</dd><dt>Janela da coleta (UTC)</dt><dd>Início: $reference · geração: $generated. O corte não muda durante a paginação. Datas futuras são avaliadas contra o instante de observação de cada conta; sucessos ocorridos durante a coleta são ativos.</dd><dt>Autenticação</dt><dd>Delegated · leitura somente · User.Read, User.Read.All, AuditLog.Read.All, LicenseAssignment.Read.All.</dd><dt>Coleta</dt><dd>$(Format-InactiveNumber $s.Total) usuários únicos; $(Format-InactiveNumber $Requests) requisições concluídas; $(Format-InactiveNumber $s.Duplicates) duplicatas de paginação ignoradas.</dd><dt>Versão da classificação</dt><dd>2 · evidência separada da classificação operacional</dd><dt>Execution ID</dt><dd><code>$safeExecutionId</code></dd></dl><ul><li>O último sucesso inclui logins interativos e não interativos. Os campos de tentativas incluem falhas e não comprovam acesso. O histórico de sucesso não foi preenchido retroativamente antes de dezembro de 2023; ausência de data não prova que a conta nunca entrou.</li><li>A Microsoft documenta que signInActivity pode ser omitido para contas sem login ou com último login anterior a abril de 2020. Isso é tratado como ausência de histórico, não como erro automático, somente dentro da coleta selecionada. Um objeto vazio/malformado não recebe esse tratamento.</li><li>Datas essenciais inválidas, datas posteriores à observação ou sucesso anterior à criação impedem a classificação. Criação ausente/inválida não invalida um sucesso utilizável, mas gera alerta; no CSV essa criação fica “Não informada”. Motivos de indeterminação e alertas estão detalhados acima.</li><li>Um estado de convite nulo não é tratado como aceito. Um convidado pode usar UPN com #EXT#: o CSV preserva o UPN real, não o substitui por outro e-mail.</li><li>O Graph pode apresentar atraso na atividade. A coleta paginada não é um snapshot transacional: alterações simultâneas podem afetar a população. Uma conta lida no início pode acessar depois da leitura sem refletir neste resultado. O relatório cobre objetos de usuário retornados, não contas excluídas ou identidades de aplicações.</li><li>A retenção dos logs detalhados é diferente do resumo signInActivity. Ausência de eventos em uma janela de logs menor que 90 dias não prova inatividade por 90 dias; esta ferramenta não usa essa inferência.</li><li>Falhas de leitura, paginação ou limites interrompem o assessment sem publicar um relatório parcial. Dados desconhecidos de licença/habilitação não são convertidos em “não”.</li><li>Os gráficos possuem legendas numéricas e bases explícitas. Categorias dentro de cada gráfico são exclusivas; indicadores entre gráficos e alertas podem se sobrepor.</li><li>Antes de bloquear contas ou remover licenças, valide responsáveis, dependências, retenção e políticas do tenant. Esta ferramenta não modifica usuários, convites nem licenças.</li></ul></section>
<footer>CloudOps · Relatório confidencial · Gerado e compactado em memória. Sem scripts, fontes, imagens ou serviços externos; gráficos SVG disponíveis offline. A proteção e o descarte dos arquivos baixados são responsabilidade do administrador.</footer>
</main></body></html>
"@
}
