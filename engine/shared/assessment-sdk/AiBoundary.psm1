Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Evaluation.psm1') -DisableNameChecking
function ConvertTo-CloudOpsAiInput {
    param([object] $AssessmentResult, [AllowEmptyCollection()] [string[]] $FactAllowlist = @())
    Assert-CloudOpsSdkDto $AssessmentResult 'AssessmentResult'
    Assert-CloudOpsSdkArray $FactAllowlist 64
    $findings=[System.Collections.Generic.List[object]]::new()
    foreach ($finding in $AssessmentResult.findings) {
        $facts=[System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
        foreach ($key in (Get-CloudOpsSdkSortedIds $FactAllowlist)) {
            # Defense beyond the profile allowlist. Even numeric aliases for
            # identifiers/secrets are not forwarded. No narratives/raw objects.
            if ($key -cnotmatch '^[a-z][A-Za-z0-9]{0,47}$' -or $key -match '(?:upn|email|displayName|guid|tenant|policyName|groupName|applicationName|raw|token|header|identifier|^id$|Id$)') { continue }
            if ($finding.observed.Contains($key) -and $null -ne $finding.observed[$key]) { $facts[$key]=$finding.observed[$key] }
        }
        $findings.Add(@{controlId=$finding.controlId;status=$finding.status;severity=$finding.risk.severity;facts=$facts})
    }
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.ai-input.v1';findings=$findings.ToArray()} 'AiInput'
}
function Invoke-CloudOpsAiEnrichment {
    param([object] $AssessmentResult, [AllowEmptyCollection()] [string[]] $FactAllowlist = @(), [AllowNull()] [scriptblock] $Provider, [ValidateRange(1,10000)] [int] $TimeoutMilliseconds = 1000)
    $unavailable=@{schemaVersion='cloudops.ai-enrichment.v1';status='UNAVAILABLE';advisory=$null}
    if ($null -eq $Provider) { return @{schemaVersion='cloudops.ai-enrichment.v1';status='NOT_REQUESTED';advisory=$null} }
    $inputObject=$null; $output=$null
    try {
        $inputObject=ConvertTo-CloudOpsAiInput $AssessmentResult $FactAllowlist
        # This release supplies only a bounded, pure fake provider interface.
        # A future external provider requires an explicitly reviewed adapter.
        $output=Invoke-CloudOpsPureScript $Provider @($inputObject) @('AiInput') $TimeoutMilliseconds
        Assert-CloudOpsSdkDto $output 'AiEnrichment'
        return Copy-CloudOpsSdkDto $output 'AiEnrichment'
    } catch { return $unavailable }
    finally { $inputObject=$null; $output=$null }
}
Export-ModuleMember -Function @('ConvertTo-CloudOpsAiInput','Invoke-CloudOpsAiEnrichment')
