Set-StrictMode -Version Latest

# Test-only fixtures. This module is never imported by the public entrypoint.
function New-IdentityDevelopmentFixture {
    param(
        [ValidateSet('baseline', 'not-applicable', 'unknown', 'partial', 'failed', 'missing-facts')]
        [string] $Scenario = 'baseline'
    )
    $facts = @{ members = 3; disabledMembers = 0; guests = 2; pendingGuests = 1 }
    $capability = 'AVAILABLE'
    $status = 'SUCCESS'
    switch ($Scenario) {
        'not-applicable' { $facts.members = 0; $facts.guests = 0; $facts.pendingGuests = 0; $capability = 'UNAVAILABLE' }
        'unknown' { $capability = 'UNKNOWN'; $facts.pendingGuests = $null }
        'partial' { $status = 'PARTIAL' }
        'failed' { $status = 'FAILED' }
        'missing-facts' { $facts.Remove('members'); $facts.Remove('guests'); $facts.pendingGuests = 0 }
    }
    $context = @{
        assessmentId = 'identity-assessment'; assessmentVersion = '0.1.0'
        sdkVersion = 'cloudops.assessment-sdk.v1'; assessmentTimestamp = '2026-09-10T12:00:00Z'
        capabilities = @{ 'user-inventory' = $capability }; dataSource = 'SYNTHETIC'
    }
    $collectorContext = @{
        calls = @{ users = 0; capability = 0; live = 0 }
        users = @{ schemaVersion = 'cloudops.collector-result.v1'; collectorId = 'fixture-users-summary'; status = $status; requestCount = 1; data = $facts; warnings = @() }
        capability = @{ schemaVersion = 'cloudops.collector-result.v1'; collectorId = 'fixture-capability-summary'; status = 'SUCCESS'; requestCount = 0; data = @{ userInventoryAvailable = ($capability -ceq 'AVAILABLE') }; warnings = @() }
    }
    $registry = @{
        'fixture-users-summary' = {
            param($CollectorContext, $Context)
            $CollectorContext.calls.users++
            return $CollectorContext.users
        }
        'fixture-capability-summary' = {
            param($CollectorContext, $Context)
            $CollectorContext.calls.capability++
            return $CollectorContext.capability
        }
        'identity-users-summary' = {
            param($CollectorContext, $Context)
            $CollectorContext.calls.live++
            throw [System.InvalidOperationException]::new('Live collection is forbidden in the synthetic harness.')
        }
    }
    return @{ Context = $context; CollectorContext = $collectorContext; CollectorRegistry = $registry }
}

function Get-IdentityDevelopmentAiProvider {
    param([ValidateSet('available', 'unavailable')] [string] $Scenario = 'available')
    if ($Scenario -ceq 'unavailable') {
        return {
            param($AiInput)
            return @{ schemaVersion = 'cloudops.ai-enrichment.v1'; status = 'UNAVAILABLE'; advisory = $null }
        }
    }
    return {
        param($AiInput)
        return @{
            schemaVersion = 'cloudops.ai-enrichment.v1'
            status = 'AVAILABLE'
            advisory = @{
                executiveNarrative = 'Synthetic advisory generated only by the development fixture.'
                technicalExplanation = 'Only approved aggregate facts are available to this fake provider.'
                riskContext = 'Advisory only. Deterministic control results remain authoritative.'
                crossFindingCorrelations = @('Review the synthetic member and guest inventory together.')
                remediationPriority = @('Inspect the failed development control before the manual exercise.')
                roadmapSuggestions = @('Obtain human approval before any future production control pack.')
            }
        }
    }
}

Export-ModuleMember -Function New-IdentityDevelopmentFixture, Get-IdentityDevelopmentAiProvider
