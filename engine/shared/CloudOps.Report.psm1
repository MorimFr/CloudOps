Set-StrictMode -Version Latest

function ConvertTo-CloudOpsReportText {
    param([AllowNull()] [object] $Value)
    return [Net.WebUtility]::HtmlEncode([string]$Value)
}
function ConvertTo-CloudOpsReportCsvCell {
    param([AllowNull()] [object] $Value)
    $text=[string]$Value
    if($text -match '^\s*[=+\-@]' -or $text -match '^[\t\r\n]'){$text="'"+$text}
    return '"'+$text.Replace('"','""')+'"'
}
function New-CloudOpsReportMetric {
    param([string] $Label,[long] $Value,[string] $Detail='', [ValidateSet('neutral','critical','high','medium','low','pass')] [string] $Tone='neutral')
    return "<article class='metric $Tone'><h3>$(ConvertTo-CloudOpsReportText $Label)</h3><strong>$Value</strong><p>$(ConvertTo-CloudOpsReportText $Detail)</p></article>"
}
function New-CloudOpsReportDistribution {
    param([Parameter(Mandatory)] [object[]] $Segments, [string] $Title)
    $total=0L
    foreach($segment in $Segments){if($segment.count -lt 0){throw 'Invalid chart count.'};$total+=$segment.count}
    $circles=[Text.StringBuilder]::new();$legend=[Text.StringBuilder]::new();$offset=0.0
    foreach($segment in $Segments){
        if($segment.color -notmatch '^#[a-fA-F0-9]{6}$'){throw 'Invalid chart color.'}
        $percent=if($total -eq 0){0.0}else{100.0*$segment.count/$total}
        $size=$percent.ToString('0.######',[cultureinfo]::InvariantCulture)
        $start=(-$offset).ToString('0.######',[cultureinfo]::InvariantCulture)
        if($percent -gt 0){[void]$circles.Append("<circle cx='60' cy='60' r='45' pathLength='100' fill='none' stroke='$($segment.color)' stroke-width='18' stroke-dasharray='$size 100' stroke-dashoffset='$start' transform='rotate(-90 60 60)'/>")}
        [void]$legend.Append("<li><span style='--segment:$($segment.color)'>$(ConvertTo-CloudOpsReportText $segment.label)</span><strong>$($segment.count)</strong><small> ($($percent.ToString('0.0',[cultureinfo]::GetCultureInfo('pt-BR')))% da base)</small></li>")
        $offset+=$percent
    }
    return "<div class='distribution'><svg viewBox='0 0 120 120' role='img' aria-label='$(ConvertTo-CloudOpsReportText $Title)'><circle cx='60' cy='60' r='45' fill='none' stroke='#e2e8f0' stroke-width='18'/>$circles<text x='60' y='64' text-anchor='middle'>$total</text></svg><div><p class='muted'>Base: $total · $(ConvertTo-CloudOpsReportText $Title)</p><ul class='legend'>$legend</ul></div></div>"
}
function New-CloudOpsReportDocument {
    # ContentHtml is composed only by code-owned renderers; all data must use
    # ConvertTo-CloudOpsReportText. No script, font, analytics or external asset.
    param([string] $Title,[string] $Description,[string[]] $MetadataPills,[string] $ContentHtml,[string] $Eyebrow='CloudOps · Assessment')
    $pills=($MetadataPills | ForEach-Object { '<span class="pill">'+(ConvertTo-CloudOpsReportText $_)+'</span>' }) -join ''
    return @"
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>$(ConvertTo-CloudOpsReportText $Title) · CloudOps</title>
<style>
:root{color-scheme:light;--ink:#17223b;--muted:#52647e;--line:#dce5f0}*{box-sizing:border-box}body{margin:0;background:#f5f8fc;color:var(--ink);font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1560px;margin:auto;padding:24px}.hero{padding:38px;border-radius:26px;color:white;background:linear-gradient(120deg,#101a33,#203d81 72%,#086b94);box-shadow:0 24px 55px #17223b20}.eyebrow{text-transform:uppercase;letter-spacing:.17em;font-weight:700;font-size:12px;color:#bce8ff}h1{font-size:clamp(30px,4vw,52px);line-height:1.1;margin:12px 0}h2{font-size:25px;margin:0 0 16px}h3{font-size:16px;margin:0 0 10px}.hero>p{max-width:1040px}.pill{display:inline-block;border:1px solid #ffffff40;background:#ffffff13;border-radius:999px;padding:7px 12px;font-size:12px;margin:6px 8px 0 0;overflow-wrap:anywhere}section{margin:32px 0}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.metric,.panel{background:white;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 5px 18px #18274206}.metric{border-top:4px solid #64748b}.metric h3{font-size:14px;color:#43536d}.metric strong{font-size:34px;line-height:1.25}.metric p,.muted{font-size:13px;color:var(--muted)}.metric p{margin:6px 0 0}.critical{border-top-color:#971c5a}.high{border-top-color:#dc2626}.medium{border-top-color:#e79000}.low{border-top-color:#168bba}.pass{border-top-color:#16a34a}.notice{border-left:4px solid #2c62f3;padding:12px 16px;background:#eff5ff}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:18px}.distribution{display:flex;align-items:center;gap:22px}.distribution svg{width:165px;max-width:38%;flex-shrink:0}.distribution text{font-size:17px;fill:var(--ink);font-weight:700}.legend{list-style:none;padding:0}.legend li{margin:10px 0}.legend span:before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--segment);margin-right:9px}.legend strong{margin-left:12px}.legend small{color:var(--muted)}.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:16px;background:white}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}th{text-align:left;background:#ecf2fa;color:#344661}th,td{padding:18px;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th:nth-child(1){width:23%}th:nth-child(2){width:17%}th:nth-child(3){width:33%}th:nth-child(4){width:27%}td p{margin:7px 0}td code{font-size:12px;white-space:normal}.severity-heading{border-left:5px solid #64748b;padding-left:12px}.severity-heading.critical{border-color:#971c5a}.severity-heading.high{border-color:#dc2626}.severity-heading.medium{border-color:#e79000}.severity-heading.low{border-color:#168bba}details summary{cursor:pointer;font-weight:700}.compact-list{padding-left:22px}.compact-list li{margin:12px 0}footer{font-size:12px;color:var(--muted);margin-top:36px}.provenance{overflow-wrap:anywhere}
@media(max-width:900px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.two-column{grid-template-columns:1fr}th,td{padding:12px}.findings-table{min-width:760px}}
@media(max-width:520px){main{padding:12px}.hero{padding:24px 20px;border-radius:20px}.metric,.panel{padding:16px}.metric strong{font-size:28px}h2{font-size:22px}.distribution{gap:12px;align-items:flex-start}.legend strong{margin-left:6px}.legend small{display:block;margin-left:19px}.pill{font-size:11px}.metrics{gap:10px}}
@media print{@page{size:A4 landscape;margin:12mm}body{background:white;font-size:11px}main{max-width:none;padding:0}.hero{padding:22px;border-radius:0;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}h1{font-size:32px}h2{font-size:20px;break-after:avoid}.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.metric,.panel{padding:13px;box-shadow:none;break-inside:avoid}.metric strong{font-size:25px}.two-column{grid-template-columns:1fr 1fr}.table-scroll{overflow:visible}.findings-table{min-width:0;font-size:10px}th,td{padding:9px}thead{display:table-header-group}tr{break-inside:avoid}.distribution{print-color-adjust:exact;-webkit-print-color-adjust:exact}.distribution svg{width:115px}details>ul{display:block!important}footer{break-inside:avoid}}
</style></head><body><main><header class="hero"><p class="eyebrow">$(ConvertTo-CloudOpsReportText $Eyebrow)</p><h1>$(ConvertTo-CloudOpsReportText $Title)</h1><p>$(ConvertTo-CloudOpsReportText $Description)</p><div>$pills</div></header>$ContentHtml<footer>CloudOps Report Standard v1 · HTML offline, sem scripts, recursos externos ou telemetria. O destinatário controla a retenção do arquivo baixado.</footer></main></body></html>
"@
}
Export-ModuleMember -Function ConvertTo-CloudOpsReportText, ConvertTo-CloudOpsReportCsvCell, New-CloudOpsReportMetric, New-CloudOpsReportDistribution, New-CloudOpsReportDocument
