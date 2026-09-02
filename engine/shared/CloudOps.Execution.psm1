Set-StrictMode -Version Latest

function Read-CloudOpsExecutionContext {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param()

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

    if ($null -eq $context -or $context -is [System.Array]) {
        throw [System.ArgumentException]::new('Execution context must be a JSON object.')
    }

    return $context
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

function Write-CloudOpsSummary {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [System.Collections.IDictionary] $Summary
    )

    Write-CloudOpsControlEvent -Event ([ordered]@{
        type    = 'summary'
        summary = $Summary
    })
}

function Write-CloudOpsFailure {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidatePattern('^[A-Z][A-Z0-9_]{0,63}$')]
        [string] $Code,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string] $Message
    )

    Write-CloudOpsControlEvent -Event ([ordered]@{
        type    = 'error'
        code    = $Code
        message = $Message
    })
}

function Write-CloudOpsArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNull()]
        [byte[]] $Bytes
    )

    if ($Bytes.Length -eq 0) {
        throw [System.ArgumentException]::new('Artifact cannot be empty.')
    }

    $standardOutput = [Console]::OpenStandardOutput()
    $standardOutput.Write($Bytes, 0, $Bytes.Length)
    $standardOutput.Flush()
}

Export-ModuleMember -Function @(
    'Read-CloudOpsExecutionContext',
    'Write-CloudOpsProgress',
    'Write-CloudOpsSummary',
    'Write-CloudOpsFailure',
    'Write-CloudOpsArtifact'
)
