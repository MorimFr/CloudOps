Set-StrictMode -Version Latest
$script:PluginRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot '../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'collectors/Wave1.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'evaluators/Wave1.psm1') -DisableNameChecking

function Get-IdentityWave1Catalog {
    return ConvertFrom-CloudOpsSdkJson ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wave1-catalog.json')))
}
function Get-IdentityWave1Definition {
    $definition = ConvertFrom-CloudOpsSdkJson ([IO.File]::ReadAllText((Join-Path $script:PluginRoot 'assessment-sdk.json')))
    Assert-CloudOpsSdkDto $definition 'Definition'
    # Fixed registered subset, never a profile-provided script or path.
    $definition.collectors = @($definition.collectors | Where-Object { $_.id -in @('authorization-policy','group-settings','device-registration-policy','admin-consent-policy') })
    $definition.evaluators = @($definition.evaluators | Where-Object { $_.id.StartsWith('cis-m365-') })
    $definition.recommendations = @($definition.recommendations | Where-Object { $_.recommendationId.StartsWith('cis-m365-') })
    $definition.controlPacks = @($definition.controlPacks | Where-Object { $_.id -ceq 'cis-m365-identity-wave1' })
    $definition.capabilities = @('entra-directory'); $definition.aiFactAllowlist = @()
    Assert-CloudOpsSdkDto $definition 'Definition'
    return $definition
}
function Get-IdentityWave1Pack {
    $definition = Get-IdentityWave1Definition
    if ($definition.controlPacks.Count -ne 1) { throw 'Invalid Wave 1 registration.' }
    $reference = $definition.controlPacks[0]
    $json = [IO.File]::ReadAllText((Join-Path $script:PluginRoot 'control-packs/cis-m365-7-0-0/identity-wave1.json'))
    $pack = Read-CloudOpsControlPack $json $reference.id $reference.version $reference.sha256
    return @{definition=$definition;pack=$pack;json=$json;hash=$reference.sha256}
}
function Invoke-IdentityWave1Assessment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('E3_L1','E3_L2','E5_L1','E5_L2')] [string] $Profile,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Context,
        [System.Collections.IDictionary] $CollectorRegistry,
        [System.Collections.IDictionary] $CollectorContext = @{},
        [scriptblock] $ProgressCallback
    )
    $loaded = Get-IdentityWave1Pack
    if ($null -eq $CollectorRegistry) { $CollectorRegistry = Get-IdentityWave1CollectorRegistry }
    if ($Context.assessmentId -cne 'identity-assessment') { throw 'Invalid assessment context.' }
    $level = if ($Profile.EndsWith('L2')) { 2 } else { 1 }
    # Profile inheritance: E3/E5 L2 includes L1. Nonselected controls are not N/A.
    $selected = @($loaded.pack.controls | Where-Object { $_.parameters.cisLevel -le $level } | ForEach-Object { $_.id })
    $parameters = @{
        ControlPackJson=$loaded.json; Definition=$loaded.definition; ControlPackHash=$loaded.hash
        CollectorRegistry=$CollectorRegistry; EvaluatorRegistry=(Get-IdentityWave1EvaluatorRegistry)
        Context=$Context; CollectorContext=$CollectorContext; SelectedControlIds=$selected
        ManifestPermissions=@('GroupSettings.Read.All','Policy.Read.All')
        Limitations=@(
            'Cobertura parcial: somente Wave 1, com 10 dos 71 controles Identity planejados. Nao representa conformidade integral ou certificacao CIS.'
            'Level 1 seleciona sete controles desta wave; Level 2 inclui os dez. Controles fora do perfil nao sao NOT_APPLICABLE.'
            'Leituras de configuracao nao constituem snapshot transacional. Erros de acesso ou dados insuficientes nao sao gaps.'
            'Licencas nao sao inventariadas. LAPS tenant-level nao comprova implantacao nos endpoints. Validar requisitos de licenca para restricao de criacao de grupos.'
            'Risco CloudOps e recomendacoes sao deterministicamente versionados; IA e apenas narrativa opcional.'
        )
    }
    if ($null -ne $ProgressCallback) { $parameters.ProgressCallback = $ProgressCallback }
    try { return Invoke-CloudOpsAssessment @parameters }
    finally { $parameters.Clear(); $loaded=$null; $CollectorContext=$null; $Context=$null }
}
Export-ModuleMember -Function Get-IdentityWave1Catalog, Get-IdentityWave1Definition, Get-IdentityWave1Pack, Invoke-IdentityWave1Assessment
