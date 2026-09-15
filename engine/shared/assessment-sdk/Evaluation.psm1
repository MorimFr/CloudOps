Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'Validation.psm1') -DisableNameChecking

# Defense in depth for reviewed implementations, NOT a hostile-plugin sandbox.
# No commands, providers, member invocation, CLR types, closures, ambient scopes,
# redirection or dynamic member access are admitted to the evaluator language.
function Assert-CloudOpsPureScript {
    param([scriptblock] $Implementation, [string[]] $ParameterNames = @('Control','State','Context'))
    $text = $Implementation.ToString()
    Assert-CloudOpsSdkCondition ($text.Length -le 32768)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
    Assert-CloudOpsSdkCondition ($errors.Count -eq 0 -and $null -ne $ast.ParamBlock -and $ast.ParamBlock.Parameters.Count -eq $ParameterNames.Count)
    $locals = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('true','false','null') + $ParameterNames) { [void]$locals.Add($name) }
    for ($i=0; $i -lt $ParameterNames.Count; $i++) {
        $parameter = $ast.ParamBlock.Parameters[$i]
        Assert-CloudOpsSdkCondition ($parameter.Name.VariablePath.UserPath -ceq $ParameterNames[$i] -and $parameter.Attributes.Count -eq 0 -and $null -eq $parameter.DefaultValue)
    }
    $nodes = $ast.FindAll({param($node) $true},$true)
    foreach ($node in $nodes) {
        if ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) {
            Assert-CloudOpsSdkCondition ($node.Left -is [System.Management.Automation.Language.VariableExpressionAst])
            [void]$locals.Add($node.Left.VariablePath.UserPath)
        }
        if ($node -is [System.Management.Automation.Language.ForEachStatementAst]) { [void]$locals.Add($node.Variable.VariablePath.UserPath) }
    }
    $allowed = @('ScriptBlockAst','ParamBlockAst','ParameterAst','NamedBlockAst','StatementBlockAst','PipelineAst','CommandExpressionAst','ConstantExpressionAst','StringConstantExpressionAst','VariableExpressionAst','AssignmentStatementAst','BinaryExpressionAst','UnaryExpressionAst','HashtableAst','ArrayExpressionAst','ArrayLiteralAst','IndexExpressionAst','ParenExpressionAst','IfStatementAst','ReturnStatementAst','ForEachStatementAst','WhileStatementAst','BreakStatementAst','ContinueStatementAst')
    foreach ($node in $nodes) {
        Assert-CloudOpsSdkCondition ($node.GetType().Name -cin $allowed)
        if ($node -is [System.Management.Automation.Language.ScriptBlockAst]) { Assert-CloudOpsSdkCondition ([object]::ReferenceEquals($node,$ast)) }
        if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $name = $node.VariablePath.UserPath
            Assert-CloudOpsSdkCondition ($name -cmatch '^[A-Za-z][A-Za-z0-9]*$' -and $locals.Contains($name) -and $name -inotmatch '^(?:ExecutionContext|PS.*|Host|Error|args|input|this|HOME|PID|PWD|OFS|ShellId|MyInvocation|Matches)$')
        }
        if ($node -is [System.Management.Automation.Language.BinaryExpressionAst]) {
            Assert-CloudOpsSdkCondition ($node.Operator.ToString() -cin @('Ieq','Ine','Igt','Ige','Ilt','Ile','Ceq','Cne','Cgt','Cge','Clt','Cle','And','Or','Xor','Plus','Minus','Multiply','Divide','Rem','Icontains','Inotcontains','Ccontains','Cnotcontains','Iin','Inotin','Cin','Cnotin'))
        }
        if ($node -is [System.Management.Automation.Language.UnaryExpressionAst]) { Assert-CloudOpsSdkCondition ($node.TokenKind.ToString() -cin @('Not','Exclaim','Minus','Plus','PlusPlus','MinusMinus','PostfixPlusPlus','PostfixMinusMinus')) }
    }
    return $text
}
function Invoke-CloudOpsPureScript {
    param([scriptblock] $Implementation, [object[]] $Arguments, [string[]] $ParameterNames = @('Control','State','Context'), [ValidateRange(1,10000)] [int] $TimeoutMilliseconds = 2000)
    $text = Assert-CloudOpsPureScript $Implementation $ParameterNames
    $session = [System.Management.Automation.Runspaces.InitialSessionState]::Create()
    $session.LanguageMode = [System.Management.Automation.PSLanguageMode]::ConstrainedLanguage
    $runspace = $null; $pipeline = $null; $handle = $null
    try {
        $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($session)
        $runspace.Open()
        $pipeline = [System.Management.Automation.PowerShell]::Create()
        $pipeline.Runspace = $runspace
        [void]$pipeline.AddScript($text,$true)
        foreach ($argument in $Arguments) { [void]$pipeline.AddArgument($argument) }
        $handle = $pipeline.BeginInvoke()
        if (-not $handle.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) {
            $pipeline.Stop()
            throw [System.TimeoutException]::new('Assessment SDK evaluator budget exceeded.')
        }
        $output = $pipeline.EndInvoke($handle)
        Assert-CloudOpsSdkCondition ($pipeline.Streams.Error.Count -eq 0 -and $output.Count -eq 1)
        return $output[0].PSObject.BaseObject
    } finally {
        if ($null -ne $pipeline) { $pipeline.Dispose() }
        if ($null -ne $handle) { $handle.AsyncWaitHandle.Dispose() }
        if ($null -ne $runspace) { $runspace.Dispose() }
        $text = $null; $Arguments = $null
    }
}
function New-CloudOpsUnresolvedControlResult {
    param([object] $Control, [string] $Status, [string] $ReasonCode)
    return Copy-CloudOpsSdkDto @{schemaVersion='cloudops.control-result.v1';controlId=$Control.id;status=$Status;applicability='UNKNOWN';confidence='LOW';observed=@{};expected=@{};evidence=@();reasonCode=$ReasonCode;riskSignals=@{exposed=$false;privileged=$false;compensatingControl=$false}} 'ControlResult'
}
function Invoke-CloudOpsEvaluation {
    param([object] $Control, [object] $State, [object] $Context, [AllowNull()] [scriptblock] $Evaluator, [ValidateRange(1,10000)] [int] $TimeoutMilliseconds = 2000)
    Assert-CloudOpsSdkDto $Control 'Control'; Assert-CloudOpsSdkDto $State 'NormalizedState'; Assert-CloudOpsSdkDto $Context 'Context'
    Assert-CloudOpsSdkCondition ($State.assessmentTimestamp -ceq $Context.assessmentTimestamp)
    if ($Control.evaluationType -cne 'AUTOMATED') { return New-CloudOpsUnresolvedControlResult $Control 'MANUAL' 'HUMAN_VALIDATION_REQUIRED' }
    Assert-CloudOpsSdkCondition ($null -ne $Evaluator)
    $datasets = [ordered]@{}
    $missing = $false; $partial = $false; $failed = $false
    foreach ($id in $Control.collectorRequirements) {
        if (-not $State.datasets.Contains($id)) { $missing = $true; continue }
        $datasets[$id] = $State.datasets[$id]
        if ($State.datasets[$id].status -ceq 'FAILED') { $failed = $true }
        if ($State.datasets[$id].status -ceq 'PARTIAL') { $partial = $true }
    }
    if ($failed) { return New-CloudOpsUnresolvedControlResult $Control 'ERROR' 'COLLECTOR_FAILED' }
    if ($missing -or $partial) { return New-CloudOpsUnresolvedControlResult $Control 'UNKNOWN' $(if($partial){'COLLECTION_PARTIAL'}else{'DATASET_UNAVAILABLE'}) }
    $safeControl = $null; $safeState = $null; $safeContext = $null
    try {
        $safeControl = Copy-CloudOpsSdkDto $Control 'Control'
        $safeState = Copy-CloudOpsSdkDto @{schemaVersion='cloudops.normalized-state.v1';assessmentTimestamp=$State.assessmentTimestamp;datasets=$datasets;capabilities=$State.capabilities} 'NormalizedState'
        $safeContext = Copy-CloudOpsSdkDto $Context 'Context'
        $result = Invoke-CloudOpsPureScript $Evaluator @($safeControl,$safeState,$safeContext) -TimeoutMilliseconds $TimeoutMilliseconds
        Assert-CloudOpsSdkDto $result 'ControlResult'
        Assert-CloudOpsSdkCondition ($result.controlId -ceq $Control.id)
        return Copy-CloudOpsSdkDto $result 'ControlResult'
    } catch { return New-CloudOpsUnresolvedControlResult $Control 'ERROR' 'EVALUATOR_FAILED' }
    finally { $safeControl=$null; $safeState=$null; $safeContext=$null; $datasets.Clear() }
}
Export-ModuleMember -Function @('Assert-CloudOpsPureScript','Invoke-CloudOpsPureScript','Invoke-CloudOpsEvaluation','New-CloudOpsUnresolvedControlResult')
