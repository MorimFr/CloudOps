#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../src/collectors/Wave1.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
$checks=0
function Check($Condition,$Message){if(-not $Condition){throw $Message};$script:checks++}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public sealed class Wave1GraphHandler : HttpMessageHandler {
    public readonly Queue<HttpResponseMessage> Responses=new Queue<HttpResponseMessage>();
    public readonly List<string> Requests=new List<string>();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r,CancellationToken c) {
        Requests.Add(r.Method.Method+" "+r.RequestUri.AbsoluteUri);
        return Task.FromResult(Responses.Count>0?Responses.Dequeue():new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }
}
'@
function Response($Body,$Status=200){$r=[Net.Http.HttpResponseMessage]::new($Status);$r.Content=[Net.Http.StringContent]::new($Body,[Text.Encoding]::UTF8,'application/json');return $r}
function Run($Id,$Responses,$MaximumPages=100){
    $handler=[Wave1GraphHandler]::new();foreach($r in $Responses){$handler.Responses.Enqueue($r)}
    $client=[Net.Http.HttpClient]::new($handler);$delays=[Collections.Generic.List[int]]::new()
    try {
        $result=Invoke-IdentityWave1Collector -CollectorId $Id -AccessToken 'synthetic-canary-token' -HttpClient $client -MaximumPages $MaximumPages -DelayAction {param($Milliseconds)$delays.Add($Milliseconds)}
        Assert-CloudOpsSdkDto $result 'CollectorResult'
        Check (($result|ConvertTo-Json -Depth 12 -Compress) -notmatch 'canary|displayName|https://|templateId|userPrincipalName') 'No raw values in normalized result'
        foreach($request in $handler.Requests){Check ($request.StartsWith('GET https://graph.microsoft.com/v1.0/')) 'Only Graph v1 GET'}
        return @{result=$result;requests=$handler.Requests.ToArray();delays=$delays.ToArray()}
    } finally{$client.Dispose()}
}
$auth='{"defaultUserRolePermissions":{"allowedToCreateApps":false,"allowedToCreateTenants":true,"allowedToCreateSecurityGroups":false,"allowedToReadBitlockerKeysForOwnedDevice":false},"guestUserRoleId":"10dae51f-b6af-4016-8d66-8c2a99b929b3","allowInvitesFrom":"adminsAndGuestInviters","displayName":"canary"}'
$r=Run 'authorization-policy' @((Response $auth))
Check ($r.result.status -ceq 'SUCCESS' -and $r.result.data.allowedToCreateApps -ceq $false -and $r.result.data.guestRoleCategory -eq 1) 'Authorization normalization'
$r=Run 'device-registration-policy' @((Response '{"userDeviceQuota":0,"localAdminPassword":{"isEnabled":true},"displayName":"canary"}'))
Check ($r.result.data.userDeviceQuota -eq 0 -and $r.result.data.lapsEnabled -ceq $true) 'Device zero and nested LAPS'
$r=Run 'admin-consent-policy' @((Response '{"isEnabled":true}'))
Check ($r.result.data.adminConsentRequestsEnabled -ceq $true) 'Consent only isEnabled required'
foreach($id in @('authorization-policy','group-settings','device-registration-policy','admin-consent-policy')){
    foreach($status in @(401,403,500)){
        $r=Run $id @((Response '{"error":{"message":"canary"}}' $status))
        $expected=if($status -eq 500){'FAILED'}else{'PARTIAL'}
        Check ($r.result.status -ceq $expected) 'API failures never success/FAIL'
    }
    $r=Run $id @((Response 'not-json'))
    Check ($r.result.status -ceq 'FAILED') 'Invalid JSON is technical failure'
}
$template='{"templateId":"62375ab9-6b52-47ed-826b-58e47e0e304b","values":[{"name":"EnableGroupCreation","value":"False"}]}'
$r=Run 'group-settings' @((Response ('{"value":['+$template+']}')))
Check ($r.result.status -ceq 'SUCCESS' -and $r.result.data.enableGroupCreation -ceq $false) 'Boolean string normalization'
$r=Run 'group-settings' @((Response ('{"value":['+$template.Replace('62375ab9-6b52-47ed-826b-58e47e0e304b','62375AB9-6B52-47ED-826B-58E47E0E304B')+']}')))
Check ($r.result.status -ceq 'SUCCESS' -and $r.result.data.groupUnifiedTemplateCount -eq 1 -and $r.result.data.enableGroupCreation -ceq $false) 'Template GUID casing cannot imply absent template'
$r=Run 'group-settings' @((Response '{"value":[]}'))
Check ($r.result.status -ceq 'SUCCESS' -and $r.result.data.groupUnifiedTemplateCount -eq 0 -and $r.result.data.groupSettingsComplete) 'Complete absent template preserved for evaluator'
$first='{"value":[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/groupSettings?$skiptoken=synthetic"}'
$r=Run 'group-settings' @((Response $first),(Response ('{"value":['+$template+']}')))
Check ($r.requests.Count -eq 2 -and $r.result.requestCount -eq 2 -and $r.result.status -ceq 'SUCCESS') 'Empty page does not terminate pagination'
$r=Run 'group-settings' @((Response $first)) 1
Check ($r.result.status -ceq 'PARTIAL') 'Truncated collection not default'
$r=Run 'group-settings' @((Response $first),(Response $first))
Check ($r.result.status -ceq 'PARTIAL' -and $r.requests.Count -eq 2) 'Repeated nextLink bounded'
foreach($link in @('https://evil.invalid/v1.0/groupSettings','https://graph.microsoft.com/v1.0/users','https://graph.microsoft.com/beta/groupSettings','https://canary@graph.microsoft.com/v1.0/groupSettings',
    'https://graph.microsoft.com/v1.0/groupSettings?$filter=hidden', 'https://graph.microsoft.com/v1.0/groupSettings?$select=id',
    'https://graph.microsoft.com/v1.0/groupSettings?$skiptoken=a&$skiptoken=b', 'https://graph.microsoft.com/v1.0/groupSettings?$expand=members')){
    $r=Run 'group-settings' @((Response ('{"value":[],"@odata.nextLink":"'+$link+'"}')))
    Check ($r.result.status -ceq 'PARTIAL' -and $r.requests.Count -eq 1) 'Unsafe nextLink rejected before request'
}
$projected='{"value":[],"@odata.nextLink":"https://graph.microsoft.com/v1.0/groupSettings?%24select=templateId%2Cvalues&%24skiptoken=synthetic%3D"}'
$r=Run 'group-settings' @((Response $projected),(Response ('{"value":['+$template+']}')))
Check ($r.requests.Count -eq 2 -and $r.result.status -ceq 'SUCCESS') 'Encoded projection and opaque paging token accepted'
foreach($json in @(('{"value":['+$template+','+$template+']}'), '{"value":[{"templateId":"62375ab9-6b52-47ed-826b-58e47e0e304b","values":[]}]}','{"value":[{}]}','{"value":[{"templateId":"invalid"}]}',('{"value":['+$template.Replace('False','invalid')+']}'))){
    $r=Run 'group-settings' @((Response $json))
    Check ($r.result.status -ceq 'PARTIAL') 'Ambiguous settings cannot produce default or verdict'
}
$throttle=Response '{}' 429;$throttle.Headers.RetryAfter=[Net.Http.Headers.RetryConditionHeaderValue]::new([TimeSpan]::FromSeconds(1))
$r=Run 'authorization-policy' @($throttle,(Response $auth))
Check ($r.result.status -ceq 'SUCCESS' -and $r.requests.Count -eq 2 -and $r.delays[0] -eq 1000) 'Graph Retry-After shared transport'
Write-Output "Wave 1 collector validation passed: $checks checks; synthetic HTTP only."
