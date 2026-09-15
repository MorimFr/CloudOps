Set-StrictMode -Version Latest

# These are CloudOps areas, not benchmark sections. Areas without an implemented
# collector remain unobserved; they must never be presented as PASS.
function Get-IdentityAreaDefinitions {
    return @(
        @{ id = 'authentication'; name = 'Authentication'; stateArea = 'authentication' },
        @{ id = 'conditional-access'; name = 'Conditional Access'; stateArea = 'conditionalAccess' },
        @{ id = 'privileged-access'; name = 'Privileged Access'; stateArea = 'roles' },
        @{ id = 'user-lifecycle'; name = 'User Lifecycle'; stateArea = 'users' },
        @{ id = 'guest-external-identity'; name = 'Guest & External Identity'; stateArea = 'guests' },
        @{ id = 'applications-consent'; name = 'Applications & Consent'; stateArea = 'applications' },
        @{ id = 'identity-governance'; name = 'Identity Governance'; stateArea = 'groups' },
        @{ id = 'licensing-capability'; name = 'Licensing / Capability Context'; stateArea = 'licensing' }
    )
}

function New-IdentityUserAggregate {
    return [ordered]@{
        total = [long] 0
        members = [long] 0
        guests = [long] 0
        enabledMembers = [long] 0
        disabledMembers = [long] 0
        pendingGuests = [long] 0
        acceptedGuests = [long] 0
        missingProperties = [long] 0
        unexpectedValues = [long] 0
    }
}

function Add-IdentityUserObservation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Aggregate,
        [Parameter(Mandatory)] [AllowNull()] [object] $RawUser
    )

    # Normalize one item immediately; never copy tenant identifiers into state.
    $Aggregate.total++
    if ($null -eq $RawUser -or $RawUser -isnot [pscustomobject]) {
        $Aggregate.missingProperties++
        return
    }
    $typeProperty = $RawUser.PSObject.Properties['userType']
    if ($null -eq $typeProperty -or $null -eq $typeProperty.Value) {
        $Aggregate.missingProperties++
        return
    }
    if ($typeProperty.Value -isnot [string] -or $typeProperty.Value -cnotin @('Member', 'Guest')) {
        $Aggregate.unexpectedValues++
        return
    }
    if ($typeProperty.Value -ceq 'Member') {
        $Aggregate.members++
        $enabledProperty = $RawUser.PSObject.Properties['accountEnabled']
        if ($null -eq $enabledProperty -or $null -eq $enabledProperty.Value) {
            $Aggregate.missingProperties++
        } elseif ($enabledProperty.Value -isnot [bool]) {
            $Aggregate.unexpectedValues++
        } elseif ($enabledProperty.Value) {
            $Aggregate.enabledMembers++
        } else {
            $Aggregate.disabledMembers++
        }
        return
    }
    $Aggregate.guests++
    $invitationProperty = $RawUser.PSObject.Properties['externalUserState']
    if ($null -eq $invitationProperty -or $null -eq $invitationProperty.Value) {
        $Aggregate.missingProperties++
    } elseif ($invitationProperty.Value -isnot [string]) {
        $Aggregate.unexpectedValues++
    } elseif ($invitationProperty.Value -ceq 'PendingAcceptance') {
        $Aggregate.pendingGuests++
    } elseif ($invitationProperty.Value -ceq 'Accepted') {
        $Aggregate.acceptedGuests++
    } else {
        $Aggregate.unexpectedValues++
    }
}

Export-ModuleMember -Function Get-IdentityAreaDefinitions, New-IdentityUserAggregate, Add-IdentityUserObservation
