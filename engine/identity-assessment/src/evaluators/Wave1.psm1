Set-StrictMode -Version Latest

# Each body is separately registered and verified by the SDK pure-language AST.
# Evaluators read only normalized facts; collection/authentication stays outside.
function Get-IdentityWave1EvaluatorRegistry {
    return @{
        'cis-m365-5-1-2-2' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['allowedToCreateApps']
            $observed = @{ allowedToCreateApps = $value }
            $expected = @{ value = $false }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $false)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-2-2-summary'; facts=@{ observed=$value; expected=$false }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-2-3' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['allowedToCreateTenants']
            $observed = @{ allowedToCreateTenants = $value }
            $expected = @{ value = $false }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $false)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-2-3-summary'; facts=@{ observed=$value; expected=$false }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-3-1' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['allowedToCreateSecurityGroups']
            $observed = @{ allowedToCreateSecurityGroups = $value }
            $expected = @{ value = $false }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $false)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-3-1-summary'; facts=@{ observed=$value; expected=$false }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-3-4' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['group-settings']['facts']
            $value = $facts['enableGroupCreation']
            $templateCount = $facts['groupUnifiedTemplateCount']
            $complete = $facts['groupSettingsComplete']
            if (($templateCount -is [int] -or $templateCount -is [long]) -and $templateCount -ceq 0 -and $complete -is [bool] -and $complete -ceq $true) { $value = $true }
            $observed = @{ enableGroupCreation=$value; templateCount=$templateCount; collectionComplete=$complete }
            $expected = @{ value = $false }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($complete -isnot [bool] -or $complete -cne $true -or ($templateCount -isnot [int] -and $templateCount -isnot [long]) -or $templateCount -lt 0 -or $templateCount -gt 1 -or ($templateCount -ceq 1 -and (($facts['groupSettingKeyCount'] -isnot [int] -and $facts['groupSettingKeyCount'] -isnot [long]) -or $facts['groupSettingKeyCount'] -cne 1)) -or $value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $false)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-3-4-summary'; facts=@{ observed=$value; expected=$false; templateCount=$templateCount; collectionComplete=$complete }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-4-2' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['device-registration-policy']['facts']
            $value = $facts['userDeviceQuota']
            $observed = @{ userDeviceQuota = $value }
            $expected = @{ minimumExpected=0; maximumExpected=10 }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or (($value -isnot [int] -and $value -isnot [long]) -or $value -lt 0)) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -le 10)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-4-2-summary'; facts=@{ configuredValue=$value; minimumExpected=0; maximumExpected=10 }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-4-5' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['device-registration-policy']['facts']
            $value = $facts['lapsEnabled']
            $observed = @{ lapsEnabled = $value }
            $expected = @{ value = $true }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $true)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-4-5-summary'; facts=@{ observed=$value; expected=$true }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-4-6' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['allowedToReadBitlockerKeysForOwnedDevice']
            $observed = @{ allowedToReadBitlockerKeysForOwnedDevice = $value }
            $expected = @{ value = $false }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $false)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-4-6-summary'; facts=@{ observed=$value; expected=$false }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-5-2' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['admin-consent-policy']['facts']
            $value = $facts['adminConsentRequestsEnabled']
            $observed = @{ adminConsentRequestsEnabled = $value }
            $expected = @{ value = $true }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or ($value -isnot [bool])) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq $true)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-5-2-summary'; facts=@{ observed=$value; expected=$true }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-6-2' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['guestRoleCategory']
            $observed = @{ guestRoleCategory = $value }
            $expected = @{ acceptedCategoryOne=1; acceptedCategoryTwo=2 }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or (($value -isnot [int] -and $value -isnot [long]) -or $value -cnotin @(1,2,3))) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq 1 -or $value -ceq 2)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-6-2-summary'; facts=@{ observedCategory=$value; acceptedCategoryOne=1; acceptedCategoryTwo=2 }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
        'cis-m365-5-1-6-3' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['authorization-policy']['facts']
            $value = $facts['invitationPolicyCategory']
            $observed = @{ invitationPolicyCategory = $value }
            $expected = @{ acceptedCategoryOne=1; acceptedCategoryTwo=2 }
            $status = 'PASS'; $applicability = 'APPLICABLE'; $confidence = 'HIGH'; $reason = 'CIS_REQUIREMENT_MET'
            if ($State['capabilities']['entra-directory'] -cne 'AVAILABLE' -or (($value -isnot [int] -and $value -isnot [long]) -or $value -cnotin @(1,2,3,4))) {
                $status = 'UNKNOWN'; $applicability = 'UNKNOWN'; $confidence = 'LOW'; $reason = 'REQUIRED_FACT_UNAVAILABLE'
            } elseif (-not ($value -ceq 1 -or $value -ceq 2)) {
                $status = 'FAIL'; $reason = 'CIS_REQUIREMENT_NOT_MET'
            }
            return @{
                schemaVersion='cloudops.control-result.v1'; controlId=$Control['id']; status=$status
                applicability=$applicability; confidence=$confidence; observed=$observed; expected=$expected
                evidence=@(@{type='cis-identity-5-1-6-3-summary'; facts=@{ observedCategory=$value; acceptedCategoryOne=1; acceptedCategoryTwo=2 }})
                reasonCode=$reason; riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}
            }
        }
    }
}
Export-ModuleMember -Function Get-IdentityWave1EvaluatorRegistry
