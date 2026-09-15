Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking
function ConvertFrom-CloudOpsSdkJsonElement {
    param([System.Text.Json.JsonElement] $Element)
    switch ($Element.ValueKind.ToString()) {
        'Object' {
            $map = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
            foreach ($property in $Element.EnumerateObject()) { $map[$property.Name] = ConvertFrom-CloudOpsSdkJsonElement $property.Value }
            return $map
        }
        'Array' {
            $items = [System.Collections.Generic.List[object]]::new()
            foreach ($item in $Element.EnumerateArray()) { $items.Add((ConvertFrom-CloudOpsSdkJsonElement $item)) }
            return ,$items.ToArray()
        }
        'String' { return $Element.GetString() }
        'Number' {
            $integer = 0L
            if ($Element.TryGetInt64([ref]$integer)) { return $integer }
            return $Element.GetDouble()
        }
        'True' { return $true }
        'False' { return $false }
        'Null' { return $null }
        default { throw [System.ArgumentException]::new('Invalid Assessment SDK JSON value.') }
    }
}
function ConvertFrom-CloudOpsSdkJson {
    param([Parameter(Mandatory)] [string] $Json)
    # Bounded JSON parser that never coerces ISO-shaped metadata into DateTime.
    # Duplicate exact keys follow JSON.parse's last-value semantics; ordinal keys
    # remain distinct. The caller still validates the resulting versioned DTO.
    Assert-CloudOpsSdkCondition ($Json.Length -le 1MB -and [System.Text.Encoding]::UTF8.GetByteCount($Json) -le 1MB)
    $document = $null
    try {
        $options = [System.Text.Json.JsonDocumentOptions]::new()
        $options.MaxDepth = 32
        $document = [System.Text.Json.JsonDocument]::Parse($Json.TrimStart([char]0xFEFF), $options)
        return ConvertFrom-CloudOpsSdkJsonElement $document.RootElement
    } finally { if ($null -ne $document) { $document.Dispose() } }
}
function Get-CloudOpsControlPackHash {
    param([Parameter(Mandatory)] [string] $Json)
    Assert-CloudOpsSdkCondition ($Json.Length -le 1MB)
    if ($Json.Length -gt 0 -and $Json[0] -eq [char]0xFEFF) { $Json = $Json.Substring(1) }
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Json.Replace("`r`n", "`n"))
    Assert-CloudOpsSdkCondition ($bytes.Length -le 1MB)
    try { return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
    finally { [Array]::Clear($bytes,0,$bytes.Length) }
}
function Read-CloudOpsControlPack {
    param([Parameter(Mandatory)] [string] $Json, [Parameter(Mandatory)] [string] $ExpectedId, [Parameter(Mandatory)] [string] $ExpectedVersion, [Parameter(Mandatory)] [string] $ExpectedHash)
    try {
        Assert-CloudOpsSdkCondition ((Get-CloudOpsControlPackHash $Json) -ceq $ExpectedHash)
        $pack = ConvertFrom-CloudOpsSdkJson $Json
        Assert-CloudOpsSdkDto $pack 'ControlPack'
        Assert-CloudOpsSdkCondition ($pack.id -ceq $ExpectedId -and $pack.controlPackVersion -ceq $ExpectedVersion)
        return $pack
    } catch { throw [System.ArgumentException]::new('Control pack preflight validation failed.') }
}
Export-ModuleMember -Function @('ConvertFrom-CloudOpsSdkJson','Get-CloudOpsControlPackHash','Read-CloudOpsControlPack')
