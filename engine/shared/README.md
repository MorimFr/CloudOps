# Módulos compartilhados do engine

Os módulos deste diretório definem a pequena superfície comum dos assessments PowerShell 7:

- `CloudOps.Execution.psm1` lê o contexto JSON de `stdin`, escreve eventos NDJSON em `stderr` e envia o artefato binário para `stdout`.
- `CloudOps.Security.psm1` valida identificadores que atravessam a fronteira Node/PowerShell e codifica texto inserido em HTML.
- `CloudOps.Graph.psm1` chama exclusivamente Microsoft Graph REST em `https://graph.microsoft.com/v1.0`, com retry e paginação controlados, sem SDK Graph.

`stdout` é um canal binário. Um assessment não deve usar `Write-Host`, `Write-Output`, `Write-Warning` ou qualquer outro mecanismo que possa contaminá-lo. Erros destinados ao chamador devem ser eventos de controle allowlisted; detalhes de tenant, tokens, contexto e conteúdo do artefato nunca pertencem a logs ou eventos. `publicMetrics` aceita apenas contadores agregados conhecidos e o booleano `graphReachable`.
