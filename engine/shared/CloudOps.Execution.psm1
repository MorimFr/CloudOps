Set-StrictMode -Version Latest

function Read-CloudOpsExecutionContext {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

    try {
        $rawContext = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($rawContext)) {
            throw [System.ArgumentException]::new('Execution context is required.')
        }

        try {
            $context = $rawContext | ConvertFrom-Json -Depth 32 -ErrorAction Stop
        }
        catch {
            throw [System.ArgumentException]::new('Execution context must be valid JSON.')
        }
        if ($null -eq $context -or $context -isnot [pscustomobject]) {
            throw [System.ArgumentException]::new('Execution context must be a JSON object.')
        }
        return $context
    }
    finally {
        $rawContext = $null
    }
}

function Write-CloudOpsControlEvent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [object] $Event
    )

    $json = $Event | ConvertTo-Json -Depth 16 -Compress
    [Console]::Error.WriteLine($json)
    [Console]::Error.Flush()
}

function Write-CloudOpsProgress {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Z][A-Z0-9_]{0,63}$')]
        [string] $Stage,

        [Parameter(Mandatory)]
        [ValidateRange(0, 100)]
        [int] $Progress
    )

    Write-CloudOpsControlEvent -Event ([ordered]@{
        type     = 'progress'
        stage    = $Stage
        progress = $Progress
    })
}

function Write-CloudOpsPublicMetrics {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Collections.IDictionary] $PublicMetrics
    )

    $numericMetrics = @('findings', 'objectsAnalyzed', 'requestsCompleted')
    $allowedMetrics = @($numericMetrics) + 'graphReachable'
    $normalized = [ordered]@{}

    foreach ($entry in $PublicMetrics.GetEnumerator()) {
        $name = [string] $entry.Key
        if ($name -cnotin $allowedMetrics) {
            throw [System.ArgumentException]::new('Public metrics contain an unsupported key.')
        }

        if ($name -ceq 'graphReachable') {
            if ($entry.Value -isnot [bool]) {
                throw [System.ArgumentException]::new('graphReachable must be a boolean.')
            }
            $normalized[$name] = [bool] $entry.Value
            continue
        }

        $numericTypes = @(
            [byte], [sbyte], [int16], [uint16], [int32], [uint32], [int64]
        )
        $isInteger = $false
        foreach ($numericType in $numericTypes) {
            if ($entry.Value -is $numericType) {
                $isInteger = $true
                break
            }
        }
        if (-not $isInteger) {
            throw [System.ArgumentException]::new('Numeric public metrics must be integers.')
        }

        $value = [int64] $entry.Value
        if ($value -lt 0 -or $value -gt 9007199254740991) {
            throw [System.ArgumentOutOfRangeException]::new($name, 'Public metric is outside the safe range.')
        }
        $normalized[$name] = $value
    }

    Write-CloudOpsControlEvent -Event ([ordered]@{
        type          = 'publicMetrics'
        publicMetrics = $normalized
    })
}

function Write-CloudOpsFailure {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet(
            'ASSESSMENT_FAILED',
            'GRAPH_CONSENT_REQUIRED',
            'GRAPH_AUTHENTICATION_FAILED',
            'GRAPH_INSUFFICIENT_PRIVILEGES',
            'GRAPH_THROTTLED',
            'GRAPH_UNAVAILABLE'
        )]
        [string] $Code
    )

    $messages = @{
        ASSESSMENT_FAILED              = 'The assessment could not be completed.'
        GRAPH_CONSENT_REQUIRED         = 'Microsoft Graph delegated consent is required.'
        GRAPH_AUTHENTICATION_FAILED    = 'Microsoft Graph authentication failed.'
        GRAPH_INSUFFICIENT_PRIVILEGES  = 'Microsoft Graph denied the delegated request.'
        GRAPH_THROTTLED                = 'Microsoft Graph throttled the request.'
        GRAPH_UNAVAILABLE              = 'Microsoft Graph is temporarily unavailable.'
    }

    Write-CloudOpsControlEvent -Event ([ordered]@{
        type    = 'error'
        code    = $Code
        message = $messages[$Code]
    })
}

function Write-CloudOpsArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [byte[]] $Bytes,

        [ValidateRange(0, [int]::MaxValue)]
        [int] $Offset = 0,

        [ValidateRange(-1, [int]::MaxValue)]
        [int] $Count = -1
    )

    if ($Count -eq -1) {
        $Count = $Bytes.Length - $Offset
    }
    if ($Count -le 0 -or $Offset -gt $Bytes.Length -or $Count -gt ($Bytes.Length - $Offset)) {
        throw [System.ArgumentException]::new('Artifact cannot be empty.')
    }

    $standardOutput = [Console]::OpenStandardOutput()
    $standardOutput.Write($Bytes, $Offset, $Count)
    $standardOutput.Flush()
}

Export-ModuleMember -Function @(
    'Read-CloudOpsExecutionContext',
    'Write-CloudOpsProgress',
    'Write-CloudOpsPublicMetrics',
    'Write-CloudOpsFailure',
    'Write-CloudOpsArtifact'
)
