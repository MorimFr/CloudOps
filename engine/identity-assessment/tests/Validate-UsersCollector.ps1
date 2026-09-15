#requires -Version 7.2
[CmdletBinding()]
param([ValidateRange(1, 500000)] [int] $ScaleUsers = 200000)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) 'src/collectors/Users.psm1') -DisableNameChecking
Import-Module (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking

function Assert-CollectorCondition {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) { throw [System.InvalidOperationException]::new($Message) }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public sealed class IdentityCollectorTestHandler : HttpMessageHandler
{
    public readonly Queue<HttpResponseMessage> Responses = new Queue<HttpResponseMessage>();
    public readonly List<string> RequestUris = new List<string>();
    public int TransportFailures;
    public int GenerateUsers;
    private int generated;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestUris.Add(request.RequestUri.AbsoluteUri);
        if (TransportFailures-- > 0)
            return Task.FromException<HttpResponseMessage>(new HttpRequestException("Synthetic transport failure containing forbidden-canary."));
        if (GenerateUsers > 0)
        {
            int count = Math.Min(999, GenerateUsers - generated);
            var json = new StringBuilder("{\"value\":[");
            for (int i = 0; i < count; i++)
            {
                if (i != 0) json.Append(',');
                json.Append("{\"userType\":\"Member\",\"accountEnabled\":true,\"externalUserState\":null}");
            }
            generated += count;
            json.Append(']');
            if (generated < GenerateUsers) json.Append(",\"@odata.nextLink\":\"https://graph.microsoft.com/v1.0/users?$skiptoken=" + generated + "\"");
            json.Append('}');
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json.ToString(), Encoding.UTF8, "application/json") });
        }
        if (Responses.Count == 0) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
        return Task.FromResult(Responses.Dequeue());
    }
}
'@

function New-CollectorResponse {
    param([int] $Status = 200, [string] $Json = '{"value":[]}', [int] $RetryAfterSeconds = 0)
    $response = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode] $Status)
    $response.Content = [System.Net.Http.StringContent]::new($Json, [System.Text.Encoding]::UTF8, 'application/json')
    if ($RetryAfterSeconds -gt 0) { $response.Headers.RetryAfter = [System.Net.Http.Headers.RetryConditionHeaderValue]::new([TimeSpan]::FromSeconds($RetryAfterSeconds)) }
    return $response
}
function Invoke-CollectorFixture {
    param([object[]] $Responses = @(), [int] $Failures = 0, [int] $MaximumPages = 1000, [int] $GenerateUsers = 0)
    $handler = [IdentityCollectorTestHandler]::new()
    $handler.TransportFailures = $Failures
    $handler.GenerateUsers = $GenerateUsers
    foreach ($response in $Responses) { $handler.Responses.Enqueue($response) }
    $client = [System.Net.Http.HttpClient]::new($handler, $true)
    $delays = [System.Collections.Generic.List[int]]::new()
    try {
        $result = Invoke-IdentityUsersCollector -AccessToken 'synthetic-token-forbidden-canary' -HttpClient $client -MaximumPages $MaximumPages -DelayAction { param([int] $Milliseconds) $delays.Add($Milliseconds) }
        Assert-CloudOpsSdkDto -Kind CollectorResult -Value $result
        Assert-CollectorCondition (($result | ConvertTo-Json -Depth 16 -Compress) -notmatch 'forbidden-canary|userPrincipalName|displayName|@example|https?://') 'Raw provider identifiers or diagnostics entered normalized state.'
        return @{ result = $result; requests = @($handler.RequestUris.ToArray()); delays = @($delays.ToArray()) }
    } finally { $client.Dispose() }
}

$memberPage = '{"value":[{"userType":"Member","accountEnabled":true,"displayName":"forbidden-canary","userPrincipalName":"canary@example.invalid"}]}'
$firstPage = '{"value":[{"userType":"Member","accountEnabled":false}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/users?$skiptoken=page-two"}'
$guestPage = '{"value":[{"userType":"Guest","accountEnabled":true,"externalUserState":"PendingAcceptance"},{"userType":"Guest","accountEnabled":false,"externalUserState":"Accepted"}]}'

$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json $firstPage), (New-CollectorResponse -Json $guestPage))
Assert-CollectorCondition ($case.result.status -ceq 'SUCCESS' -and $case.result.requestCount -eq 2 -and $case.result.data.total -eq 3) '200 response pagination did not aggregate both pages.'
Assert-CollectorCondition ($case.result.data.disabledMembers -eq 1 -and $case.result.data.pendingGuests -eq 1 -and $case.result.data.acceptedGuests -eq 1) 'Member or guest normalization differs from fixture.'
Assert-CollectorCondition ($case.requests[0] -ceq 'https://graph.microsoft.com/v1.0/users?$select=userType,accountEnabled,externalUserState&$top=999' -and $case.requests[1] -ceq 'https://graph.microsoft.com/v1.0/users?$skiptoken=page-two') 'Collector changed the approved minimal projection or opaque nextLink.'

foreach ($status in @(429, 500)) {
    $response = if ($status -eq 429) { New-CollectorResponse -Status $status -RetryAfterSeconds 2 } else { New-CollectorResponse -Status $status }
    $case = Invoke-CollectorFixture -Responses @($response, (New-CollectorResponse -Json $memberPage))
    Assert-CollectorCondition ($case.result.status -ceq 'SUCCESS' -and $case.requests.Count -eq 2 -and $case.result.requestCount -eq 1) 'Retry did not preserve completed-page accounting.'
    $expectedDelay = if ($status -eq 429) { 2000 } else { 1000 }
    Assert-CollectorCondition ($case.delays.Count -eq 1 -and $case.delays[0] -eq $expectedDelay) 'Retry-After or transient backoff was not honored.'
}
foreach ($status in @(401, 403)) {
    $case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Status $status -Json '{"message":"forbidden-canary"}'))
    Assert-CollectorCondition ($case.result.status -ceq 'FAILED' -and $case.requests.Count -eq 1 -and $case.result.requestCount -eq 0) 'Authentication/permission failure retried or became a successful collection.'
}
foreach ($json in @(
    '{"value":[{}]}',
    '{"value":[{"userType":null}]}',
    '{"value":[{"userType":"UnexpectedType"}]}',
    '{"value":[{"userType":"Member","accountEnabled":null}]}',
    '{"value":[{"userType":"Member","accountEnabled":"true"}]}',
    '{"value":[{"userType":"Guest","externalUserState":null}]}',
    '{"value":[{"userType":"Guest","externalUserState":"UnexpectedState"}]}'
)) {
    $case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json $json))
    Assert-CollectorCondition ($case.result.status -ceq 'PARTIAL' -and ($case.result.data.missingProperties + $case.result.data.unexpectedValues) -gt 0) 'Missing/null/unexpected properties were interpreted as complete data.'
}
foreach ($json in @('{}', '{"value":null}', '{"value":{}}', '{"value":')) {
    $case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json $json))
    Assert-CollectorCondition ($case.result.status -ceq 'FAILED') 'Malformed page was accepted.'
}
$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse))
Assert-CollectorCondition ($case.result.status -ceq 'SUCCESS' -and $case.result.data.total -eq 0 -and $case.result.requestCount -eq 1) 'Valid empty page is not a successful empty inventory.'
$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json $firstPage), (New-CollectorResponse -Status 403))
Assert-CollectorCondition ($case.result.status -ceq 'PARTIAL' -and $case.result.data.total -eq 1 -and $case.result.requestCount -eq 1) 'A later failed page discarded partial evidence or claimed full success.'
$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json $firstPage)) -MaximumPages 1
Assert-CollectorCondition ($case.result.status -ceq 'PARTIAL' -and $case.requests.Count -eq 1) 'Page budget exhaustion failed to signal incomplete collection.'
$case = Invoke-CollectorFixture -Failures 1 -Responses @((New-CollectorResponse -Json $memberPage))
Assert-CollectorCondition ($case.result.status -ceq 'SUCCESS' -and $case.requests.Count -eq 2) 'Synthetic network interruption did not retry.'
$case = Invoke-CollectorFixture -Failures 3
Assert-CollectorCondition ($case.result.status -ceq 'FAILED' -and $case.requests.Count -eq 3) 'Exhausted network retries did not fail safely.'
$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Status 429 -RetryAfterSeconds 60))
Assert-CollectorCondition ($case.result.status -ceq 'FAILED' -and $case.requests.Count -eq 1 -and $case.delays.Count -eq 0) 'Excessive Retry-After was shortened or retried early.'
$case = Invoke-CollectorFixture -Responses @((New-CollectorResponse -Json '{"value":[{"userType":"Member","accountEnabled":true}],"@odata.nextLink":"https://untrusted.invalid/users"}'))
Assert-CollectorCondition ($case.result.status -ceq 'PARTIAL' -and $case.requests.Count -eq 1) 'Untrusted nextLink was requested.'

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$case = Invoke-CollectorFixture -GenerateUsers $ScaleUsers
$timer.Stop()
$expectedPages = [int] [Math]::Ceiling($ScaleUsers / 999.0)
Assert-CollectorCondition ($case.result.status -ceq 'SUCCESS' -and $case.result.data.total -eq $ScaleUsers -and $case.result.data.enabledMembers -eq $ScaleUsers) 'Large synthetic inventory lost users.'
Assert-CollectorCondition ($case.requests.Count -eq $expectedPages -and $case.result.requestCount -eq $expectedPages -and $case.result.data.Count -eq 9) 'Large collection was not one page request per 999 users with bounded aggregate output.'
[Console]::WriteLine(('PASS: Identity Users collector: 200/pagination, Retry-After, 500, 401/403, null/missing/enums, partial, network, host pinning; {0} synthetic users / {1} pages / {2:N1}s; nine aggregate counters, no individual records retained.' -f $ScaleUsers, $expectedPages, $timer.Elapsed.TotalSeconds))
