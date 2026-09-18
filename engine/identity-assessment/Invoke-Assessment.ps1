#requires -Version 7.2
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$sharedDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'shared'
Import-Module (Join-Path $sharedDirectory 'CloudOps.Execution.psm1') -DisableNameChecking
Import-Module (Join-Path $sharedDirectory 'CloudOps.Security.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'src/Wave1Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'src/report/Wave1Report.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'src/ExecutiveSummary.psm1') -DisableNameChecking

$context = $null
$inputReader = $null
$archive=$null;$buffer=$null;$accessToken=$null;$outcome=$null;$ai=$null;$aiInput=$null;$raw=$null
try {
    # Identity alone uses a private newline request/response channel. Other
    # assessments retain the legacy EOF context protocol.
    $inputReader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.Encoding]::UTF8,$false,4096,$true)
    $raw=$inputReader.ReadLine()
    if([string]::IsNullOrWhiteSpace($raw) -or [Text.Encoding]::UTF8.GetByteCount($raw) -gt 160KB){throw 'Invalid execution context.'}
    $context=ConvertFrom-Json $raw -Depth 24 -AsHashtable;$raw=$null
    $null = Assert-CloudOpsIdentifier -Value ([string] $context.executionId) -Name 'executionId'
    if ($context.assessmentId -cne 'identity-assessment') { throw [System.ArgumentException]::new('Invalid assessment context.') }
    if($context.auth.provider -cne 'microsoft-graph'){throw 'Graph authentication required.'}
    $tenantId=Assert-CloudOpsTenantId ([string]$context.auth.tenantId)
    $accessToken=Assert-CloudOpsTransientAccessToken ([string]$context.auth.accessToken)
    $profile=$context.options['cisProfile']
    if($profile -isnot [string] -or $profile -cnotin @('E3_L1','E3_L2','E5_L1','E5_L2')){throw 'Explicit CIS profile required.'}
    foreach($key in $context.options.Keys){if($key -cnotin @('cisProfile','organizationName')){throw 'Unsupported assessment option.'}}
    $name=$context.options['organizationName']
    if($null -ne $name -and ($name -isnot [string] -or $name.Length -gt 200 -or $name -match '[\p{Cc}\p{Cf}]')){throw 'Invalid organization label.'}
    if([string]::IsNullOrWhiteSpace($name)){$name='Não informado (nome não consultado no Graph)'}
    $sdkContext=@{assessmentId='identity-assessment';assessmentVersion='0.1.0';sdkVersion='cloudops.assessment-sdk.v1';assessmentTimestamp=[DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ",[cultureinfo]::InvariantCulture);capabilities=@{'entra-directory'='AVAILABLE'};dataSource='LIVE'}
    Write-CloudOpsProgress -Stage 'INITIALIZING' -Progress 10
    $outcome=Invoke-IdentityWave1Assessment -Profile $profile -Context $sdkContext -CollectorContext @{AccessToken=$accessToken} -ProgressCallback {param($Stage,$Progress) Write-CloudOpsProgress -Stage $Stage -Progress $Progress}
    $accessToken=$null;$context.auth.accessToken=$null
    $catalog=Get-IdentityWave1Catalog
    $aiInput=ConvertTo-IdentityExecutiveSummaryInput $outcome.reportModel $catalog $profile
    $ai=Request-IdentityExecutiveSummary $aiInput -Reader $inputReader;$aiInput=$null
    Write-CloudOpsProgress -Stage 'GENERATING_REPORT' -Progress 90
    $metadata=@{tenantName=$name;tenantId=$tenantId;profile=$profile;capabilitySummary='Configuração Entra via Graph v1.0; licenciamento não inventariado. Acesso insuficiente indicado por controle.'}
    $archive=New-IdentityWave1Archive $outcome.reportModel $catalog $metadata $ai
    $ai=$null;$outcome=$null
    $buffer=$archive.GetBuffer()
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    Write-CloudOpsArtifact -Bytes $buffer -Count ([int]$archive.Length)
} catch {
    Write-CloudOpsFailure -Code 'ASSESSMENT_FAILED'
    exit 1
} finally {
    if($null -ne $buffer){[Array]::Clear($buffer,0,$buffer.Length)}
    if($null -ne $archive){$archive.Dispose()}
    if($null -ne $inputReader){$inputReader.Dispose()}
    $raw=$null;$accessToken=$null;$context=$null;$outcome=$null;$ai=$null;$aiInput=$null
}
