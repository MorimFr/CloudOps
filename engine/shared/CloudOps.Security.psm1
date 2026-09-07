Set-StrictMode -Version Latest

function Assert-CloudOpsIdentifier {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value,

        [Parameter(Mandatory)]
        [ValidateSet('executionId', 'assessmentId')]
        [string] $Name
    )

    if ($Value -notmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,127}$') {
        throw [System.ArgumentException]::new("$Name has an invalid format.")
    }

    return $Value
}

function ConvertTo-CloudOpsHtmlText {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    return [System.Net.WebUtility]::HtmlEncode($Value)
}

function Assert-CloudOpsTenantId {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    $tenantId = [guid]::Empty
    if (-not [guid]::TryParseExact($Value, 'D', [ref] $tenantId)) {
        throw [System.ArgumentException]::new('tenantId has an invalid format.')
    }

    return $tenantId.ToString('D')
}

function Assert-CloudOpsTransientAccessToken {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string] $Value
    )

    if (
        [string]::IsNullOrWhiteSpace($Value) -or
        $Value.Length -gt 65536 -or
        $Value -match '[\x00-\x20\x7f]'
    ) {
        throw [System.ArgumentException]::new('Transient access token is invalid.')
    }

    return $Value
}

Export-ModuleMember -Function @(
    'Assert-CloudOpsIdentifier',
    'Assert-CloudOpsTenantId',
    'Assert-CloudOpsTransientAccessToken',
    'ConvertTo-CloudOpsHtmlText'
)
