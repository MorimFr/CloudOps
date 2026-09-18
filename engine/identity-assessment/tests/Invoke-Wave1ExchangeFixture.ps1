#requires -Version 7.2
# Fixed local-only fixture. Never registered or selected by production options.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot '../../shared/CloudOps.Execution.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'Wave1Fixture.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/ExecutiveSummary.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot '../src/report/Wave1Report.psm1') -DisableNameChecking
$archive=$null;$zip=$null;$buffer=$null;$ai=$null;$inputReader=$null
try {
    $inputReader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.Encoding]::UTF8,$false,4096,$true)
    $context=ConvertFrom-Json ($inputReader.ReadLine()) -AsHashtable
    if($context.assessmentId -cne 'identity-assessment' -or $context.Contains('auth')){throw 'Synthetic context required.'}
    $expectedMode=$context.options.expectedMode
    if($expectedMode -cnotin @('AI_ENRICHED','DETERMINISTIC')){throw 'Expected mode required.'}
    Write-CloudOpsProgress -Stage 'PROCESSING' -Progress 50
    $fixture=New-IdentityWave1ReportFixture
    $report=$fixture.outcome.reportModel
    $findingsBefore=New-IdentityWave1FindingsCsv $report $fixture.catalog
    $controlsBefore=New-IdentityWave1ControlsCsv $report $fixture.catalog
    $inputDto=ConvertTo-IdentityExecutiveSummaryInput $report $fixture.catalog E3_L2
    $ai=Request-IdentityExecutiveSummary $inputDto -Reader $inputReader
    $archive=New-IdentityWave1Archive $report $fixture.catalog $fixture.metadata $ai
    $zip=[IO.Compression.ZipArchive]::new($archive,[IO.Compression.ZipArchiveMode]::Read,$true)
    if(($zip.Entries.FullName -join ',') -cne 'report.html,findings.csv,controls.csv,metadata.json'){throw 'ZIP entries changed.'}
    foreach($entry in $zip.Entries){
        $reader=[IO.StreamReader]::new($entry.Open())
        try{$content=$reader.ReadToEnd()}finally{$reader.Dispose()}
        switch($entry.FullName){
            'findings.csv' {if($content -cne $findingsBefore){throw 'AI changed findings.'}}
            'controls.csv' {if($content -cne $controlsBefore){throw 'AI changed controls.'}}
            'metadata.json' {if((ConvertFrom-Json $content).executiveSummaryMode -cne $expectedMode){throw 'Unexpected summary mode.'}}
            'report.html' {if(-not $content.Contains("data-mode='$expectedMode'")){throw 'Unexpected report mode.'}}
        }
    }
    $zip.Dispose();$zip=$null
    $buffer=$archive.GetBuffer()
    Write-CloudOpsProgress -Stage 'COMPLETED' -Progress 100
    Write-CloudOpsArtifact -Bytes $buffer -Count ([int]$archive.Length)
} catch {
    Write-CloudOpsFailure -Code 'ASSESSMENT_FAILED'
    exit 1
} finally {
    if($null -ne $zip){$zip.Dispose()}
    if($null -ne $archive){$bytes=$archive.GetBuffer();[Array]::Clear($bytes,0,$bytes.Length);$archive.Dispose()}
    if($null -ne $inputReader){$inputReader.Dispose()}
    $ai=$null;$context=$null;$inputDto=$null;$report=$null;$fixture=$null
}
