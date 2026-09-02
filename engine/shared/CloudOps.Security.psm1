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

Export-ModuleMember -Function @(
    'Assert-CloudOpsIdentifier',
    'ConvertTo-CloudOpsHtmlText'
)
