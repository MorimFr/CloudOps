Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot '../src/Wave1Assessment.psm1') -DisableNameChecking
function New-IdentityWave1ReportFixture {
    $context=@{assessmentId='identity-assessment';assessmentVersion='0.1.0';sdkVersion='cloudops.assessment-sdk.v1';assessmentTimestamp='2026-09-16T12:00:00Z';capabilities=@{'entra-directory'='AVAILABLE'};dataSource='SYNTHETIC'}
    $registry=@{}
    foreach($id in @('authorization-policy','group-settings','device-registration-policy','admin-consent-policy')) {
        $collectorId=$id
        $registry[$id]={param($CollectorContext,$Context)
            return @{schemaVersion='cloudops.collector-result.v1';collectorId=$collectorId;status='SUCCESS';requestCount=1;warnings=@();data=@{
                allowedToCreateApps=$true;allowedToCreateTenants=$true;allowedToCreateSecurityGroups=$false;allowedToReadBitlockerKeysForOwnedDevice=$true
                guestRoleCategory=3;invitationPolicyCategory=2;userDeviceQuota=11;lapsEnabled=$false;adminConsentRequestsEnabled=$false
                enableGroupCreation=$false;groupUnifiedTemplateCount=1;groupSettingKeyCount=1;groupSettingsComplete=$true
            }}
        }.GetNewClosure()
    }
    $outcome=Invoke-IdentityWave1Assessment -Profile E3_L2 -Context $context -CollectorRegistry $registry
    return @{outcome=$outcome;catalog=(Get-IdentityWave1Catalog);metadata=@{tenantName='Organização sintética <canary>';tenantId='11111111-1111-4111-8111-111111111111';capabilitySummary='Configuração sintética; licenciamento não inventariado';profile='E3_L2'}}
}
Export-ModuleMember -Function New-IdentityWave1ReportFixture
