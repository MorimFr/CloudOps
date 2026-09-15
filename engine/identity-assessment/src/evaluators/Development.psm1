Set-StrictMode -Version Latest

function Get-IdentityDevelopmentEvaluatorRegistry {
    # Bodies are intentionally a tiny, data-only language. The SDK verifies AST
    # and runs these in an empty constrained runspace: no network, Graph, token,
    # filesystem, methods, function invocation, or clock is available.
    return @{
        'dev-enabled-members' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['fixture-users-summary']['facts']
            $capability = $State['capabilities']['user-inventory']
            $observed = @{ members = $facts['members']; disabledMembers = $facts['disabledMembers'] }
            $expected = @{ maximumDisabledMembers = $Control['parameters']['maximumDisabledMembers'] }
            $status = 'PASS'
            $applicability = 'APPLICABLE'
            $confidence = 'HIGH'
            $reasonCode = 'SYNTHETIC_MEMBER_CONDITION_MET'
            if ($capability -eq 'UNAVAILABLE' -or $facts['members'] -eq 0) {
                $status = 'NOT_APPLICABLE'
                $applicability = 'NOT_APPLICABLE'
                $reasonCode = 'SYNTHETIC_MEMBER_CONDITION_NOT_APPLICABLE'
            } elseif ($capability -eq 'UNKNOWN' -or $State['datasets']['fixture-capability-summary']['facts']['userInventoryAvailable'] -ne $true -or $facts['members'] -eq $null -or $facts['disabledMembers'] -eq $null) {
                $status = 'UNKNOWN'
                $applicability = 'UNKNOWN'
                $confidence = 'LOW'
                $reasonCode = 'SYNTHETIC_CAPABILITY_UNKNOWN'
            } elseif ($facts['disabledMembers'] -gt $Control['parameters']['maximumDisabledMembers']) {
                $status = 'FAIL'
                $reasonCode = 'SYNTHETIC_MEMBER_CONDITION_NOT_MET'
            }
            return @{
                schemaVersion = 'cloudops.control-result.v1'
                controlId = $Control['id']
                status = $status
                applicability = $applicability
                confidence = $confidence
                observed = $observed
                expected = $expected
                evidence = @(@{ type = 'inventory-summary'; facts = $observed })
                reasonCode = $reasonCode
                riskSignals = @{ exposed = $false; privileged = $false; compensatingControl = $false }
            }
        }
        'dev-guest-invitations' = {
            param($Control, $State, $Context)
            $facts = $State['datasets']['fixture-users-summary']['facts']
            $observed = @{ guests = $facts['guests']; pendingGuests = $facts['pendingGuests'] }
            $expected = @{ maximumPendingGuests = $Control['parameters']['maximumPendingGuests'] }
            $status = 'PASS'
            $applicability = 'APPLICABLE'
            $confidence = 'HIGH'
            $reasonCode = 'SYNTHETIC_GUEST_CONDITION_MET'
            $exposed = $false
            if ($facts['guests'] -eq 0) {
                $status = 'NOT_APPLICABLE'
                $applicability = 'NOT_APPLICABLE'
                $reasonCode = 'SYNTHETIC_GUEST_CONDITION_NOT_APPLICABLE'
            } elseif ($facts['guests'] -eq $null -or $facts['pendingGuests'] -eq $null) {
                $status = 'UNKNOWN'
                $applicability = 'UNKNOWN'
                $confidence = 'LOW'
                $reasonCode = 'SYNTHETIC_GUEST_DATA_INSUFFICIENT'
            } elseif ($facts['pendingGuests'] -gt $Control['parameters']['maximumPendingGuests']) {
                $status = 'FAIL'
                $exposed = $true
                $reasonCode = 'SYNTHETIC_GUEST_CONDITION_NOT_MET'
            }
            return @{
                schemaVersion = 'cloudops.control-result.v1'
                controlId = $Control['id']
                status = $status
                applicability = $applicability
                confidence = $confidence
                observed = $observed
                expected = $expected
                evidence = @(@{ type = 'inventory-summary'; facts = $observed })
                reasonCode = $reasonCode
                riskSignals = @{ exposed = $exposed; privileged = $false; compensatingControl = $false }
            }
        }
    }
}

Export-ModuleMember -Function Get-IdentityDevelopmentEvaluatorRegistry
