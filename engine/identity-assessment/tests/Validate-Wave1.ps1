#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../src/Wave1Assessment.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/evaluators/Wave1.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/collectors/Wave1.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../../shared/assessment-sdk/CloudOps.Assessment.psm1') -DisableNameChecking
$checks=0
function Check($Condition,$Message) { if (-not $Condition) { throw $Message }; $script:checks++ }
$loaded=Get-IdentityWave1Pack
$evaluators=Get-IdentityWave1EvaluatorRegistry
$catalog=Get-IdentityWave1Catalog
$context=@{assessmentId='identity-assessment';assessmentVersion='0.1.0';sdkVersion='cloudops.assessment-sdk.v1';assessmentTimestamp='2026-09-16T12:00:00Z';capabilities=@{'entra-directory'='AVAILABLE'};dataSource='SYNTHETIC'}
Check ($loaded.pack.controls.Count -eq 10) 'Exactly ten controls'
foreach ($control in $loaded.pack.controls) {
    $null=Assert-CloudOpsPureScript $evaluators[$control.id]
    $fact=$catalog[$control.id].fact
    $good=switch($fact){ 'lapsEnabled'{$true};'adminConsentRequestsEnabled'{$true};'userDeviceQuota'{10};'guestRoleCategory'{1};'invitationPolicyCategory'{1};default{$false} }
    $bad=switch($fact){ 'lapsEnabled'{$false};'adminConsentRequestsEnabled'{$false};'userDeviceQuota'{11};'guestRoleCategory'{3};'invitationPolicyCategory'{4};default{$true} }
    foreach ($case in @('PASS','FAIL','UNKNOWN','ERROR','PARTIAL','MISSING','CAPABILITY','WRONG_TYPE')) {
        $facts=@{}; $facts[$fact]=if($case -ceq 'FAIL'){$bad}elseif($case -ceq 'UNKNOWN'){$null}else{$good}
        if($fact -ceq 'enableGroupCreation'){ $facts.groupUnifiedTemplateCount=1; $facts.groupSettingKeyCount=1; $facts.groupSettingsComplete=$true }
        if($case -ceq 'WRONG_TYPE'){$facts[$fact]=if($good -is [bool]){1}else{$true}}
        $state=@{schemaVersion='cloudops.normalized-state.v1';assessmentTimestamp=$context.assessmentTimestamp;datasets=@{};capabilities=@{'entra-directory'='AVAILABLE'}}
        $state.datasets[$control.collectorRequirements[0]]=@{status=$(if($case -ceq 'ERROR'){'FAILED'}elseif($case -ceq 'PARTIAL'){'PARTIAL'}else{'SUCCESS'});facts=$facts}
        if($case -ceq 'MISSING'){$state.datasets=@{}}
        if($case -ceq 'CAPABILITY'){$state.capabilities['entra-directory']='UNAVAILABLE'}
        $result=Invoke-CloudOpsEvaluation $control $state $context $evaluators[$control.id]
        $expected=if($case -in @('PARTIAL','MISSING','CAPABILITY','WRONG_TYPE')){'UNKNOWN'}else{$case}
        Check ($result.status -ceq $expected) ($control.id+': '+$case+' got '+$result.status+' '+$result.reasonCode)
        Check ($result.status -cne 'NOT_APPLICABLE') 'No implicit exemption'
        if($case -ceq 'FAIL') { Check ($result.evidence.Count -gt 0 -and $result.observed.Count -gt 0 -and $result.expected.Count -gt 0) 'Objective evidence required' }
    }
}
# Codebook and strict source types, independent from verdicts.
foreach($case in @(
    @{id='cis-m365-5-1-6-2';facts=@{guestRoleCategory=2};status='PASS'},
    @{id='cis-m365-5-1-6-3';facts=@{invitationPolicyCategory=2};status='PASS'},
    @{id='cis-m365-5-1-6-3';facts=@{invitationPolicyCategory=3};status='FAIL'},
    @{id='cis-m365-5-1-4-2';facts=@{userDeviceQuota=0};status='PASS'},
    @{id='cis-m365-5-1-3-4';facts=@{groupUnifiedTemplateCount=0;groupSettingKeyCount=0;groupSettingsComplete=$true;enableGroupCreation=$null};status='FAIL'},
    @{id='cis-m365-5-1-3-4';facts=@{groupUnifiedTemplateCount=1;groupSettingKeyCount=2;groupSettingsComplete=$true;enableGroupCreation=$false};status='UNKNOWN'},
    @{id='cis-m365-5-1-3-4';facts=@{groupUnifiedTemplateCount=$false;groupSettingKeyCount=0;groupSettingsComplete=$true;enableGroupCreation=$null};status='UNKNOWN'},
    @{id='cis-m365-5-1-3-4';facts=@{groupUnifiedTemplateCount=1;groupSettingKeyCount=$true;groupSettingsComplete=$true;enableGroupCreation=$false};status='UNKNOWN'},
    @{id='cis-m365-5-1-3-4';facts=@{groupUnifiedTemplateCount=0;groupSettingKeyCount=0;groupSettingsComplete=1;enableGroupCreation=$null};status='UNKNOWN'}
)) {
    $control=@($loaded.pack.controls | Where-Object {$_.id -ceq $case.id})[0]
    $state=@{schemaVersion='cloudops.normalized-state.v1';assessmentTimestamp=$context.assessmentTimestamp;datasets=@{};capabilities=@{'entra-directory'='AVAILABLE'}}
    $state.datasets[$control.collectorRequirements[0]]=@{status='SUCCESS';facts=$case.facts}
    $result=Invoke-CloudOpsEvaluation $control $state $context $evaluators[$control.id]
    Check ($result.status -ceq $case.status) ($case.id+': boundary expected '+$case.status+' got '+$result.status)
}
$a=ConvertTo-IdentityPolicyFacts 'authorization-policy' ([pscustomobject]@{defaultUserRolePermissions=[pscustomobject]@{allowedToCreateApps='false'};guestUserRoleId='2af84b1e-32c8-42b7-82bc-daa82404023b';allowInvitesFrom='none'})
Check ($null -eq $a.allowedToCreateApps -and $a.guestRoleCategory -eq 2 -and $a.invitationPolicyCategory -eq 2) 'Strict boolean and accepted categories'
$a=ConvertTo-IdentityPolicyFacts 'authorization-policy' ([pscustomobject]@{guestUserRoleId='2AF84B1E-32C8-42B7-82BC-DAA82404023B'})
Check ($a.guestRoleCategory -eq 2) 'Product role GUID casing does not change its category'
$a=ConvertTo-IdentityPolicyFacts 'authorization-policy' ([pscustomobject]@{guestUserRoleId='unknown';allowInvitesFrom='unknown'})
Check ($null -eq $a.guestRoleCategory -and $null -eq $a.invitationPolicyCategory) 'Unknown enums remain unknown'
foreach($value in @(0,1,10,11,-1,1.5,'10')) {
    $a=ConvertTo-IdentityPolicyFacts 'device-registration-policy' ([pscustomobject]@{userDeviceQuota=$value})
    if($value -is [string] -or $value -lt 0 -or $value -eq 1.5){Check ($null -eq $a.userDeviceQuota) 'Invalid quota'}else{Check ($a.userDeviceQuota -eq $value) 'Integer quota'}
}
# No network: fixture collectors record reuse and feed the complete SDK pipeline.
$script:calls=@{}
$registry=@{}
foreach($id in @('authorization-policy','group-settings','device-registration-policy','admin-consent-policy')) {
    $collectorId=$id
    $registry[$id]={param($CollectorContext,$Context)
        $CollectorContext.calls[$collectorId]=1+$CollectorContext.calls[$collectorId]
        return @{schemaVersion='cloudops.collector-result.v1';collectorId=$collectorId;status='SUCCESS';requestCount=1;warnings=@();data=@{
            allowedToCreateApps=$false;allowedToCreateTenants=$false;allowedToCreateSecurityGroups=$false;allowedToReadBitlockerKeysForOwnedDevice=$false
            guestRoleCategory=1;invitationPolicyCategory=2;userDeviceQuota=10;lapsEnabled=$true;adminConsentRequestsEnabled=$true
            enableGroupCreation=$false;groupUnifiedTemplateCount=1;groupSettingKeyCount=1;groupSettingsComplete=$true
        }}
    }.GetNewClosure()
}
foreach($profile in @('E3_L1','E3_L2','E5_L1','E5_L2')) {
    $calls=@{'authorization-policy'=0;'group-settings'=0;'device-registration-policy'=0;'admin-consent-policy'=0}
    $outcome=Invoke-IdentityWave1Assessment -Profile $profile -Context $context -CollectorRegistry $registry -CollectorContext @{calls=$calls}
    $count=if($profile.EndsWith('L1')){7}else{10}
    Check ($outcome.result.coverage.passedControls -eq $count) 'Profile selection and all PASS'
    Check ($calls['authorization-policy'] -eq 1 -and $calls['device-registration-policy'] -eq 1 -and $calls['admin-consent-policy'] -eq 1) 'Shared collector once'
    Check ($calls['group-settings'] -eq $(if($count -eq 10){1}else{0})) 'Only selected collector planned'
}
Write-Output "Wave 1 validation passed: $checks checks. No real Graph or AI calls."
