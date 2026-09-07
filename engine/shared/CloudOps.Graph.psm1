Set-StrictMode -Version Latest

$script:CloudOpsGraphBaseUri = [System.Uri]::new('https://graph.microsoft.com/v1.0/')
$script:CloudOpsRetryStatusCodes = @(429, 500, 502, 503, 504)
$script:CloudOpsMaximumResponseBytes = 16MB

function New-CloudOpsGraphException {
    param(
        [Parameter(Mandatory)]
        [ValidateSet(
            'GRAPH_CONSENT_REQUIRED',
            'GRAPH_AUTHENTICATION_FAILED',
            'GRAPH_INSUFFICIENT_PRIVILEGES',
            'GRAPH_THROTTLED',
            'GRAPH_UNAVAILABLE'
        )]
        [string] $Code
    )

    $exception = [System.InvalidOperationException]::new('Microsoft Graph request failed safely.')
    $exception.Data['CloudOpsCode'] = $Code
    return $exception
}

function Assert-CloudOpsGraphUri {
    param(
        [Parameter(Mandatory)]
        [System.Uri] $Uri
    )

    $validVersionPath = (
        $Uri.AbsolutePath -ceq '/v1.0' -or
        $Uri.AbsolutePath.StartsWith('/v1.0/', [System.StringComparison]::Ordinal)
    )
    if (
        -not $Uri.IsAbsoluteUri -or
        $Uri.Scheme -cne [System.Uri]::UriSchemeHttps -or
        $Uri.IdnHost -cne 'graph.microsoft.com' -or
        -not $Uri.IsDefaultPort -or
        -not [string]::IsNullOrEmpty($Uri.UserInfo) -or
        -not $validVersionPath -or
        $Uri.Fragment.Length -ne 0
    ) {
        throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
    }

    return $Uri
}

function ConvertTo-CloudOpsGraphUri {
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $Path
    )

    if (
        $Path.Length -gt 4096 -or
        $Path.Contains('\') -or
        -not $Path.StartsWith('/', [System.StringComparison]::Ordinal) -or
        $Path.StartsWith('//', [System.StringComparison]::Ordinal) -or
        $Path -match '^[A-Za-z][A-Za-z0-9+.-]*:'
    ) {
        throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
    }

    $relativePath = $Path.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
    }

    return Assert-CloudOpsGraphUri -Uri ([System.Uri]::new($script:CloudOpsGraphBaseUri, $relativePath))
}

function Assert-CloudOpsGraphAccessToken {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $AccessToken
    )

    if (
        [string]::IsNullOrWhiteSpace($AccessToken) -or
        $AccessToken.Length -gt 65536 -or
        $AccessToken -match '[\x00-\x20\x7f]'
    ) {
        throw (New-CloudOpsGraphException -Code 'GRAPH_AUTHENTICATION_FAILED')
    }
}

function Get-CloudOpsRetryDelayMilliseconds {
    param(
        [Parameter(Mandatory)]
        [System.Net.Http.HttpResponseMessage] $Response,

        [Parameter(Mandatory)]
        [ValidateRange(1, 10)]
        [int] $Attempt,

        [Parameter(Mandatory)]
        [ValidateRange(0, 60)]
        [int] $MaximumRetryAfterSeconds
    )

    $seconds = [Math]::Min([Math]::Pow(2, $Attempt - 1), $MaximumRetryAfterSeconds)
    $retryAfter = $Response.Headers.RetryAfter
    if ($null -ne $retryAfter) {
        if ($null -ne $retryAfter.Delta) {
            $seconds = $retryAfter.Delta.TotalSeconds
        }
        elseif ($null -ne $retryAfter.Date) {
            $seconds = ($retryAfter.Date - [DateTimeOffset]::UtcNow).TotalSeconds
        }
    }

    $seconds = [Math]::Max(0, [Math]::Min($seconds, $MaximumRetryAfterSeconds))
    return [int] [Math]::Ceiling($seconds * 1000)
}

function Invoke-CloudOpsGraphRequest {
    [CmdletBinding(DefaultParameterSetName = 'Path')]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $AccessToken,

        [Parameter(Mandatory, ParameterSetName = 'Path')]
        [ValidateNotNullOrEmpty()]
        [string] $Path,

        [Parameter(Mandatory, ParameterSetName = 'Uri')]
        [ValidateNotNull()]
        [System.Uri] $Uri,

        [ValidateSet('GET', 'POST')]
        [string] $Method = 'GET',

        [AllowNull()]
        [object] $Body,

        [ValidateRange(1, 5)]
        [int] $MaximumAttempts = 3,

        [ValidateRange(0, 60)]
        [int] $MaximumRetryAfterSeconds = 10,

        [System.Net.Http.HttpClient] $HttpClient,

        [scriptblock] $DelayAction = {
            param([int] $Milliseconds)
            if ($Milliseconds -gt 0) {
                Start-Sleep -Milliseconds $Milliseconds
            }
        }
    )

    Assert-CloudOpsGraphAccessToken -AccessToken $AccessToken
    $requestUri = if ($PSCmdlet.ParameterSetName -ceq 'Uri') {
        Assert-CloudOpsGraphUri -Uri $Uri
    }
    else {
        ConvertTo-CloudOpsGraphUri -Path $Path
    }

    $ownsClient = $false
    if ($null -eq $HttpClient) {
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $HttpClient = [System.Net.Http.HttpClient]::new($handler, $true)
        $ownsClient = $true
    }

    try {
        for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt++) {
            $request = [System.Net.Http.HttpRequestMessage]::new(
                [System.Net.Http.HttpMethod]::new($Method),
                $requestUri
            )
            $response = $null
            $bodyBytes = $null

            try {
                $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new(
                    'Bearer',
                    $AccessToken
                )
                $request.Headers.Accept.Add(
                    [System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new('application/json')
                )

                if ($Method -ceq 'POST') {
                    $bodyJson = $Body | ConvertTo-Json -Depth 24 -Compress
                    $bodyBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($bodyJson)
                    $request.Content = [System.Net.Http.ByteArrayContent]::new($bodyBytes)
                    $request.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new(
                        'application/json'
                    )
                    $bodyJson = $null
                }

                try {
                    $response = $HttpClient.SendAsync(
                        $request,
                        [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
                    ).GetAwaiter().GetResult()
                }
                catch {
                    if ($attempt -lt $MaximumAttempts) {
                        $retrySeconds = [Math]::Min(
                            [Math]::Pow(2, $attempt - 1),
                            $MaximumRetryAfterSeconds
                        )
                        $retryDelay = [int] [Math]::Ceiling($retrySeconds * 1000)
                        $null = & $DelayAction $retryDelay
                        continue
                    }
                    throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
                }
                $statusCode = [int] $response.StatusCode

                if ($response.IsSuccessStatusCode) {
                    $declaredLength = $response.Content.Headers.ContentLength
                    if (
                        $null -ne $declaredLength -and
                        $declaredLength -gt $script:CloudOpsMaximumResponseBytes
                    ) {
                        throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
                    }

                    $responseStream = $null
                    $responseBuffer = $null
                    $readBuffer = $null
                    try {
                        $responseStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                        $responseBuffer = [System.IO.MemoryStream]::new()
                        $readBuffer = [byte[]]::new(81920)

                        while (($bytesRead = $responseStream.Read($readBuffer, 0, $readBuffer.Length)) -gt 0) {
                            if (
                                $responseBuffer.Length -gt
                                ($script:CloudOpsMaximumResponseBytes - $bytesRead)
                            ) {
                                throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
                            }
                            $responseBuffer.Write($readBuffer, 0, $bytesRead)
                        }

                        if ($responseBuffer.Length -eq 0) {
                            return [pscustomobject]@{}
                        }

                        $responseBytes = $responseBuffer.GetBuffer()
                        $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
                        $json = $utf8.GetString(
                            $responseBytes,
                            0,
                            [int] $responseBuffer.Length
                        )
                        try {
                            return $json | ConvertFrom-Json -Depth 64 -ErrorAction Stop
                        }
                        catch {
                            throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
                        }
                        finally {
                            $json = $null
                        }
                    }
                    finally {
                        if ($null -ne $readBuffer) {
                            [Array]::Clear($readBuffer, 0, $readBuffer.Length)
                        }
                        if ($null -ne $responseBuffer) {
                            try {
                                $responseBytes = $responseBuffer.GetBuffer()
                                [Array]::Clear($responseBytes, 0, $responseBytes.Length)
                            }
                            catch {
                                # Best-effort managed-buffer cleanup.
                            }
                            $responseBuffer.Dispose()
                        }
                        if ($null -ne $responseStream) {
                            $responseStream.Dispose()
                        }
                    }
                }

                if ($statusCode -eq 401) {
                    throw (New-CloudOpsGraphException -Code 'GRAPH_AUTHENTICATION_FAILED')
                }
                if ($statusCode -eq 403) {
                    throw (New-CloudOpsGraphException -Code 'GRAPH_INSUFFICIENT_PRIVILEGES')
                }

                if ($statusCode -in $script:CloudOpsRetryStatusCodes) {
                    if ($attempt -lt $MaximumAttempts) {
                        $delayParameters = @{
                            Response = $response
                            Attempt = $attempt
                            MaximumRetryAfterSeconds = $MaximumRetryAfterSeconds
                        }
                        $delay = Get-CloudOpsRetryDelayMilliseconds @delayParameters
                        $null = & $DelayAction $delay
                        continue
                    }

                    $code = if ($statusCode -eq 429) {
                        'GRAPH_THROTTLED'
                    }
                    else {
                        'GRAPH_UNAVAILABLE'
                    }
                    throw (New-CloudOpsGraphException -Code $code)
                }

                throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
            }
            catch {
                if ($_.Exception.Data.Contains('CloudOpsCode')) {
                    throw
                }
                throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
            }
            finally {
                if ($null -ne $bodyBytes) {
                    [Array]::Clear($bodyBytes, 0, $bodyBytes.Length)
                }
                if ($null -ne $response) {
                    $response.Dispose()
                }
                $request.Dispose()
            }
        }
    }
    finally {
        if ($ownsClient -and $null -ne $HttpClient) {
            $HttpClient.Dispose()
        }
    }

    throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
}

function Get-CloudOpsGraphCollection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $AccessToken,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $Path,

        [ValidateRange(1, 10000)]
        [int] $MaximumPages = 1000,

        [ValidateRange(1, 5)]
        [int] $MaximumAttempts = 3,

        [ValidateRange(0, 60)]
        [int] $MaximumRetryAfterSeconds = 10,

        [System.Net.Http.HttpClient] $HttpClient,

        [scriptblock] $DelayAction = {
            param([int] $Milliseconds)
            if ($Milliseconds -gt 0) {
                Start-Sleep -Milliseconds $Milliseconds
            }
        }
    )

    $nextUri = ConvertTo-CloudOpsGraphUri -Path $Path
    $visited = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )

    for ($pageNumber = 1; $pageNumber -le $MaximumPages; $pageNumber++) {
        if (-not $visited.Add($nextUri.AbsoluteUri)) {
            throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
        }

        $pageParameters = @{
            AccessToken = $AccessToken
            Uri = $nextUri
            MaximumAttempts = $MaximumAttempts
            MaximumRetryAfterSeconds = $MaximumRetryAfterSeconds
            HttpClient = $HttpClient
            DelayAction = $DelayAction
        }
        $page = Invoke-CloudOpsGraphRequest @pageParameters

        if ($null -eq $page.PSObject.Properties['value']) {
            throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
        }

        foreach ($item in @($page.value)) {
            Write-Output $item
        }

        $nextLinkProperty = $page.PSObject.Properties['@odata.nextLink']
        if ($null -eq $nextLinkProperty -or [string]::IsNullOrWhiteSpace([string] $nextLinkProperty.Value)) {
            return
        }

        $candidate = $null
        if (
            -not [System.Uri]::TryCreate(
                [string] $nextLinkProperty.Value,
                [System.UriKind]::Absolute,
                [ref] $candidate
            )
        ) {
            throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
        }
        $nextUri = Assert-CloudOpsGraphUri -Uri $candidate
    }

    throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
}

function Invoke-CloudOpsGraphBatch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $AccessToken,

        [Parameter(Mandatory)]
        [ValidateCount(1, 20)]
        [object[]] $Requests,

        [System.Net.Http.HttpClient] $HttpClient
    )

    foreach ($request in $Requests) {
        $url = [string] $request.url
        $method = [string] $request.method
        $id = [string] $request.id
        if (
            [string]::IsNullOrWhiteSpace($id) -or
            $id.Length -gt 64 -or
            $method -cnotin @('GET', 'POST') -or
            [string]::IsNullOrWhiteSpace($url) -or
            -not $url.StartsWith('/', [System.StringComparison]::Ordinal) -or
            $url.StartsWith('//', [System.StringComparison]::Ordinal) -or
            $url.Contains('://') -or
            $url.Contains('\')
        ) {
            throw (New-CloudOpsGraphException -Code 'GRAPH_UNAVAILABLE')
        }
    }

    $batchParameters = @{
        AccessToken = $AccessToken
        Path = '/$batch'
        Method = 'POST'
        Body = [ordered]@{ requests = $Requests }
        HttpClient = $HttpClient
    }
    return Invoke-CloudOpsGraphRequest @batchParameters
}

Export-ModuleMember -Function @(
    'Invoke-CloudOpsGraphRequest',
    'Get-CloudOpsGraphCollection',
    'Invoke-CloudOpsGraphBatch'
)
