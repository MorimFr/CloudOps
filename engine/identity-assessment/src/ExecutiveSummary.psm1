Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'report/Wave1Report.psm1') -DisableNameChecking

function ConvertTo-IdentityExecutiveSummaryInput {
    param([System.Collections.IDictionary] $ReportModel,[System.Collections.IDictionary] $Catalog,[ValidateSet('E3_L1','E3_L2','E5_L1','E5_L2')] [string] $Profile)
    Assert-CloudOpsSdkDto $ReportModel 'ReportModel'
    $c=$ReportModel.coverage;$s=$ReportModel.summary
    # Reconstruct; never serialize the report/context/metadata/Graph object to AI.
    $findings=@(foreach($f in $ReportModel.findings){
        @{controlId=$f.controlId;area=$f.area;status=$f.status;severity=$f.risk.severity;facts=@{};gapLabel=$(if($f.status -ceq 'FAIL'){$Catalog[$f.controlId].gapLabel}else{'no-confirmed-gap'})}
    })
    return @{framework='cis-m365';frameworkVersion='7.0.0';profile=$Profile
        controlCounts=@{total=$c.totalControls;passed=$c.passedControls;failed=$c.failedControls;manual=$c.manualResultControls;unknown=$c.unknownControls;error=$c.errorControls;notApplicable=$c.notApplicableControls}
        severityCounts=@{critical=$s.criticalFindings;high=$s.highFindings;medium=$s.mediumFindings;low=$s.lowFindings};findings=$findings}
}
function Request-IdentityExecutiveSummary {
    param([System.Collections.IDictionary] $SanitizedInput, [Parameter(Mandatory)] [IO.StreamReader] $Reader)
    $json=$null;$line=$null;$response=$null
    try {
        $json=@{type='aiExecutiveSummaryRequest';input=$SanitizedInput} | ConvertTo-Json -Depth 12 -Compress
        if([Text.Encoding]::UTF8.GetByteCount($json) -gt 16384){return $null}
        [Console]::Error.WriteLine($json);[Console]::Error.Flush();$json=$null
        # Backend has a 30-second absolute budget; engine cannot wait indefinitely.
        # Console.In.ReadLineAsync is synchronous. Use the same asynchronous
        # StreamReader as the context read so the bounded wait is effective.
        $read=$Reader.ReadLineAsync()
        if(-not $read.Wait(31000)){return $null}
        $line=$read.GetAwaiter().GetResult()
        if([string]::IsNullOrEmpty($line) -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 65536){return $null}
        $response=ConvertFrom-CloudOpsSdkJson $line
        if($response.Count -ne 2 -or $response['type'] -cne 'aiExecutiveSummaryResponse' -or -not $response.Contains('summary')){return $null}
        if(Test-IdentityExecutiveSummary $response.summary){return $response.summary}
        return $null
    } catch { return $null }
    finally{$json=$null;$line=$null;$response=$null;$SanitizedInput=$null}
}
Export-ModuleMember -Function ConvertTo-IdentityExecutiveSummaryInput, Request-IdentityExecutiveSummary
