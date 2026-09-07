#requires -Version 7.2

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

trap {
    $failureLocation = 'FAIL: Graph module validation at {0}: {1}' -f @(
        $_.InvocationInfo.ScriptLineNumber,
        $_.Exception.GetType().Name
    )
    [Console]::Error.WriteLine($failureLocation)
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}

function Assert-Condition {
    param(
        [Parameter(Mandatory)]
        [bool] $Condition,

        [Parameter(Mandatory)]
        [string] $Message
    )

    if (-not $Condition) {
        throw [System.InvalidOperationException]::new($Message)
    }
}

function New-TestResponse {
    param(
        [Parameter(Mandatory)]
        [int] $StatusCode,

        [string] $Json = '{}'
    )

    $response = [System.Net.Http.HttpResponseMessage]::new(
        [System.Net.HttpStatusCode] $StatusCode
    )
    $response.Content = [System.Net.Http.StringContent]::new(
        $Json,
        [System.Text.Encoding]::UTF8,
        'application/json'
    )
    return $response
}

function New-TestClient {
    param(
        [AllowEmptyCollection()]
        [System.Net.Http.HttpResponseMessage[]] $Responses = @(),

        [ValidateRange(0, 10)]
        [int] $TransportFailures = 0
    )

    $handler = [CloudOpsGraphTestHandler]::new()
    foreach ($response in $Responses) {
        $handler.Enqueue($response)
    }
    $handler.TransportFailuresRemaining = $TransportFailures
    return [pscustomobject]@{
        Handler = $handler
        Client = [System.Net.Http.HttpClient]::new($handler, $true)
    }
}

function Assert-GraphFailure {
    param(
        [Parameter(Mandatory)]
        [scriptblock] $Action,

        [Parameter(Mandatory)]
        [string] $ExpectedCode
    )

    try {
        $null = & $Action
        throw [System.InvalidOperationException]::new('Expected the Graph operation to fail.')
    }
    catch {
        $actualCode = [string] $_.Exception.Data['CloudOpsCode']
        Assert-Condition -Condition ($actualCode -ceq $ExpectedCode) -Message "Expected $ExpectedCode but received $actualCode."
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

public sealed class CloudOpsGraphTestHandler : HttpMessageHandler
{
    private readonly Queue<HttpResponseMessage> responses = new Queue<HttpResponseMessage>();
    public readonly List<string> RequestUris = new List<string>();
    public readonly List<string> Methods = new List<string>();
    public readonly List<string> AuthenticationSchemes = new List<string>();
    public int TransportFailuresRemaining { get; set; }

    public void Enqueue(HttpResponseMessage response)
    {
        responses.Enqueue(response);
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        RequestUris.Add(request.RequestUri == null ? string.Empty : request.RequestUri.AbsoluteUri);
        Methods.Add(request.Method.Method);
        AuthenticationSchemes.Add(
            request.Headers.Authorization == null
                ? string.Empty
                : request.Headers.Authorization.Scheme);

        if (TransportFailuresRemaining > 0)
        {
            TransportFailuresRemaining--;
            return Task.FromException<HttpResponseMessage>(
                new HttpRequestException("Synthetic transport failure."));
        }

        if (responses.Count == 0)
        {
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.InternalServerError));
        }

        return Task.FromResult(responses.Dequeue());
    }
}

public sealed class CloudOpsUnknownLengthContent : HttpContent
{
    private readonly byte[] payload;

    public CloudOpsUnknownLengthContent(string value)
    {
        payload = System.Text.Encoding.UTF8.GetBytes(value);
    }

    protected override Task SerializeToStreamAsync(
        Stream stream,
        TransportContext context)
    {
        return stream.WriteAsync(payload, 0, payload.Length);
    }

    protected override bool TryComputeLength(out long length)
    {
        length = 0;
        return false;
    }

    protected override Task<Stream> CreateContentReadStreamAsync()
    {
        return Task.FromResult<Stream>(new MemoryStream(payload, false));
    }
}
'@

$engineRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $engineRoot 'shared/CloudOps.Graph.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $engineRoot 'shared/CloudOps.Execution.psm1') -Force -DisableNameChecking

$token = 'opaque-test-token'
$noDelay = { param([int] $Milliseconds) }

$fixture = New-TestClient -Responses @(
    (New-TestResponse -StatusCode 200 -Json '{"id":"principal-1","displayName":"Test User","userPrincipalName":"test@example.invalid"}')
)
try {
    $result = Invoke-CloudOpsGraphRequest -AccessToken $token -Path '/me?$select=id' -HttpClient $fixture.Client
    Assert-Condition -Condition ($result.id -ceq 'principal-1') -Message 'A valid Graph response was not parsed.'
    Assert-Condition -Condition ($fixture.Handler.RequestUris[0] -ceq 'https://graph.microsoft.com/v1.0/me?$select=id') -Message 'The Graph base URL or version is not fixed.'
    Assert-Condition -Condition ($fixture.Handler.AuthenticationSchemes[0] -ceq 'Bearer') -Message 'The Graph request did not use Bearer authentication.'
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -TransportFailures 1 -Responses @(
    (New-TestResponse -StatusCode 200 -Json '{"id":"after-transport-retry"}')
)
try {
    $requestParameters = @{
        AccessToken = $token
        Path = '/me'
        HttpClient = $fixture.Client
        DelayAction = $noDelay
    }
    $result = Invoke-CloudOpsGraphRequest @requestParameters
    Assert-Condition -Condition ($result.id -ceq 'after-transport-retry') -Message 'A transport failure did not retry.'
    Assert-Condition -Condition ($fixture.Handler.RequestUris.Count -eq 2) -Message 'A transport failure retried an unexpected number of times.'
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -TransportFailures 2 -Responses @()
try {
    Assert-GraphFailure -ExpectedCode 'GRAPH_UNAVAILABLE' -Action {
        Invoke-CloudOpsGraphRequest -AccessToken $token -Path '/me' -MaximumAttempts 2 -HttpClient $fixture.Client -DelayAction $noDelay
    }
}
finally {
    $fixture.Client.Dispose()
}

foreach ($case in @(
    @{ Status = 401; Code = 'GRAPH_AUTHENTICATION_FAILED' },
    @{ Status = 403; Code = 'GRAPH_INSUFFICIENT_PRIVILEGES' }
)) {
    $fixture = New-TestClient -Responses @(
        (New-TestResponse -StatusCode $case.Status -Json '{"sensitive":"must-not-be-read"}')
    )
    try {
        Assert-GraphFailure -ExpectedCode $case.Code -Action {
            Invoke-CloudOpsGraphRequest -AccessToken $token -Path '/me' -HttpClient $fixture.Client
        }
    }
    finally {
        $fixture.Client.Dispose()
    }
}

$throttled = New-TestResponse -StatusCode 429 -Json '{"sensitive":"must-not-be-read"}'
$throttled.Headers.RetryAfter = [System.Net.Http.Headers.RetryConditionHeaderValue]::new(
    [TimeSpan]::FromSeconds(2)
)
$fixture = New-TestClient -Responses @(
    $throttled,
    (New-TestResponse -StatusCode 200 -Json '{"id":"after-retry"}')
)
$delays = [System.Collections.Generic.List[int]]::new()
try {
    $requestParameters = @{
        AccessToken = $token
        Path = '/me'
        HttpClient = $fixture.Client
        DelayAction = { param([int] $Milliseconds) $delays.Add($Milliseconds) }
    }
    $result = Invoke-CloudOpsGraphRequest @requestParameters
    Assert-Condition -Condition ($result.id -ceq 'after-retry') -Message 'A throttled request did not retry.'
    Assert-Condition -Condition ($fixture.Handler.RequestUris.Count -eq 2) -Message 'A throttled request retried an unexpected number of times.'
    Assert-Condition -Condition ($delays.Count -eq 1 -and $delays[0] -eq 2000) -Message 'Retry-After was not honored.'
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -Responses @(
    (New-TestResponse -StatusCode 500 -Json '{}'),
    (New-TestResponse -StatusCode 200 -Json '{"id":"after-server-error"}')
)
try {
    $requestParameters = @{
        AccessToken = $token
        Path = '/me'
        HttpClient = $fixture.Client
        DelayAction = $noDelay
    }
    $result = Invoke-CloudOpsGraphRequest @requestParameters
    Assert-Condition -Condition ($result.id -ceq 'after-server-error') -Message 'A transient server error did not retry.'
    Assert-Condition -Condition ($fixture.Handler.RequestUris.Count -eq 2) -Message 'A server error retried an unexpected number of times.'
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -Responses @(
    (New-TestResponse -StatusCode 200 -Json '{"value":[{"id":"1"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/users?$skiptoken=opaque"}'),
    (New-TestResponse -StatusCode 200 -Json '{"value":[{"id":"2"}]}')
)
try {
    $collectionParameters = @{
        AccessToken = $token
        Path = '/users?$select=id'
        HttpClient = $fixture.Client
        DelayAction = $noDelay
    }
    $items = @(Get-CloudOpsGraphCollection @collectionParameters)
    Assert-Condition -Condition (($items.id -join ',') -ceq '1,2') -Message 'Graph pagination did not emit both pages.'
    Assert-Condition -Condition ($fixture.Handler.RequestUris.Count -eq 2) -Message 'Graph pagination made an unexpected number of requests.'
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -Responses @(
    (New-TestResponse -StatusCode 200 -Json '{"value":[{"id":"1"}],"@odata.nextLink":"https://attacker.invalid/v1.0/users"}')
)
try {
    Assert-GraphFailure -ExpectedCode 'GRAPH_UNAVAILABLE' -Action {
        Get-CloudOpsGraphCollection -AccessToken $token -Path '/users' -HttpClient $fixture.Client -DelayAction $noDelay
    }
}
finally {
    $fixture.Client.Dispose()
}

$fixture = New-TestClient -Responses @(
    (New-TestResponse -StatusCode 429 -Json '{}'),
    (New-TestResponse -StatusCode 429 -Json '{}')
)
try {
    Assert-GraphFailure -ExpectedCode 'GRAPH_THROTTLED' -Action {
        $requestParameters = @{
            AccessToken = $token
            Path = '/me'
            MaximumAttempts = 2
            HttpClient = $fixture.Client
            DelayAction = $noDelay
        }
        Invoke-CloudOpsGraphRequest @requestParameters
    }
}
finally {
    $fixture.Client.Dispose()
}

$graphModule = Get-Module -Name 'CloudOps.Graph' -ErrorAction Stop
$oversizedResponse = [System.Net.Http.HttpResponseMessage]::new(
    [System.Net.HttpStatusCode]::OK
)
$oversizedResponse.Content = [CloudOpsUnknownLengthContent]::new(
    '{"value":"' + ('x' * 128) + '"}'
)
$fixture = New-TestClient -Responses @($oversizedResponse)
try {
    & $graphModule {
        $script:CloudOpsMaximumResponseBytes = 64
    }
    Assert-GraphFailure -ExpectedCode 'GRAPH_UNAVAILABLE' -Action {
        Invoke-CloudOpsGraphRequest -AccessToken $token -Path '/me' -HttpClient $fixture.Client
    }
}
finally {
    & $graphModule {
        $script:CloudOpsMaximumResponseBytes = 16MB
    }
    $fixture.Client.Dispose()
}

Assert-GraphFailure -ExpectedCode 'GRAPH_AUTHENTICATION_FAILED' -Action {
    Invoke-CloudOpsGraphRequest -AccessToken 'token with whitespace' -Path '/me'
}

$metricsRejected = $false
try {
    Write-CloudOpsPublicMetrics -PublicMetrics @{
        graphReachable = $true
        userPrincipalName = 'must-not-be-public'
    }
}
catch {
    $metricsRejected = $true
    Assert-Condition -Condition ($_.Exception.Message -notmatch 'must-not-be-public') -Message 'A rejected public metric value was reflected.'
}
Assert-Condition -Condition $metricsRejected -Message 'An arbitrary public metric was accepted.'

[Console]::WriteLine('PASS: Graph REST validation, safe errors, retry, Retry-After, pagination, host pinning, and strict public metrics validated.')
