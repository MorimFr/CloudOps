Set-StrictMode -Version Latest

$script:IdentityPluginRoot = Split-Path -Parent $PSScriptRoot
$sharedDirectory = Join-Path (Split-Path -Parent $script:IdentityPluginRoot) 'shared'
Import-Module (Join-Path $sharedDirectory 'assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'collectors/Users.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'evaluators/Development.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'report/Report.psm1') -DisableNameChecking

function Get-IdentityAssessmentDefinition {
    # Fixed deployment files only. No user-provided path or runtime pack upload.
    $json = [System.IO.File]::ReadAllText((Join-Path $script:IdentityPluginRoot 'assessment-sdk.json'))
    try {
        $definition = ConvertFrom-CloudOpsSdkJson -Json $json
        Assert-CloudOpsSdkDto -Kind Definition -Value $definition
        return $definition
    } finally { $json = $null }
}

function Get-IdentityDevelopmentControlPack {
    [CmdletBinding()]
    param(
        [ValidateSet('cloudops-identity-dev', 'cloudops-identity-alternate-dev')]
        [string] $ControlPackId = 'cloudops-identity-dev'
    )
    $definition = Get-IdentityAssessmentDefinition
    # DEV harness remains isolated from production registry and capabilities.
    $definition.collectors = @($definition.collectors | Where-Object { $_.id -notin @('authorization-policy','group-settings','device-registration-policy','admin-consent-policy') })
    $definition.evaluators = @($definition.evaluators | Where-Object { $_.id.StartsWith('dev-') })
    $definition.recommendations = @($definition.recommendations | Where-Object { $_.recommendationId.StartsWith('dev-') })
    $definition.capabilities = @('user-inventory')
    $definition.controlPacks = @($definition.controlPacks | Where-Object { $_.id.EndsWith('-dev') })
    $reference = @($definition.controlPacks | Where-Object { $_.id -ceq $ControlPackId })
    if ($reference.Count -ne 1) { throw [System.InvalidOperationException]::new('Identity development pack is not registered.') }
    # The path is selected from code-owned constants; profile metadata never
    # supplies a path to PowerShell or selects executable code.
    $file = switch ($ControlPackId) {
        'cloudops-identity-dev' { 'cloudops-identity-dev.json' }
        'cloudops-identity-alternate-dev' { 'cloudops-identity-alternate-dev.json' }
    }
    $json = [System.IO.File]::ReadAllText((Join-Path $script:IdentityPluginRoot "control-packs/$file"))
    try {
        $pack = Read-CloudOpsControlPack -Json $json -ExpectedId $reference[0].id -ExpectedVersion $reference[0].version -ExpectedHash $reference[0].sha256
        return @{ definition = $definition; pack = $pack; json = $json; hash = $reference[0].sha256 }
    } finally { $json = $null }
}

function Get-IdentityLiveCollectorRegistry {
    # Not activated by either DEV pack or by the disabled public manifest.
    # Credential access is isolated to provider-specific collector code.
    return @{
        'identity-users-summary' = {
            param($CollectorContext, $Context)
            Invoke-IdentityUsersCollector -AccessToken $CollectorContext.accessToken
        }
    }
}

function Invoke-IdentityDevelopmentAssessment {
    [CmdletBinding()]
    param(
        [ValidateSet('cloudops-identity-dev', 'cloudops-identity-alternate-dev')]
        [string] $ControlPackId = 'cloudops-identity-dev',
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Context,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $CollectorRegistry,
        [System.Collections.IDictionary] $CollectorContext = @{},
        [scriptblock] $AiProvider,
        [ValidateRange(1, 10000)] [int] $AiTimeoutMilliseconds = 1000,
        [scriptblock] $ProgressCallback
    )
    Assert-CloudOpsSdkDto -Kind Context -Value $Context
    if ($Context.assessmentId -cne 'identity-assessment' -or $Context.dataSource -cne 'SYNTHETIC') {
        throw [System.ArgumentException]::new('Development assessment requires synthetic context.')
    }
    $loaded = Get-IdentityDevelopmentControlPack -ControlPackId $ControlPackId
    $parameters = @{
        ControlPackJson = $loaded.json
        Definition = $loaded.definition
        CollectorRegistry = $CollectorRegistry
        EvaluatorRegistry = Get-IdentityDevelopmentEvaluatorRegistry
        Context = $Context
        ManifestPermissions = @()
        CollectorContext = $CollectorContext
        ControlPackHash = $loaded.hash
        AiTimeoutMilliseconds = $AiTimeoutMilliseconds
        Limitations = @(
            'SYNTHETIC DEVELOPMENT DATA ONLY. This is not CIS and not an assessment of a tenant.'
            'The development controls intentionally test the SDK, not production security policy. Do not enable, disable, remove or reinvite real accounts based on them.'
            'Areas not present in this development pack are unassessed, not compliant.'
            'MANUAL and HYBRID controls require human validation. Missing data and collector failures are not FAIL verdicts.'
            'No real Graph or LLM call is made by the development harness. Optional AI is advisory and cannot alter deterministic results.'
        )
    }
    if ($null -ne $AiProvider) { $parameters.AiProvider = $AiProvider }
    if ($null -ne $ProgressCallback) { $null = & $ProgressCallback 'PROCESSING' 30 }
    try {
        $outcome = Invoke-CloudOpsAssessment @parameters
        if ($null -ne $ProgressCallback) { $null = & $ProgressCallback 'PROCESSING' 80 }
        return $outcome
    } finally {
        $parameters.Clear()
        $CollectorContext = $null
        $Context = $null
        $loaded = $null
    }
}

Export-ModuleMember -Function Get-IdentityAssessmentDefinition, Get-IdentityDevelopmentControlPack, Get-IdentityLiveCollectorRegistry, Invoke-IdentityDevelopmentAssessment
