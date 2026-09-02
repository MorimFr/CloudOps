# Módulos compartilhados do engine

Os módulos deste diretório definem a pequena superfície comum dos assessments PowerShell 7:

- `CloudOps.Execution.psm1` lê o contexto JSON de `stdin`, escreve eventos NDJSON em `stderr` e envia o artefato binário para `stdout`.
- `CloudOps.Security.psm1` valida identificadores que atravessam a fronteira Node/PowerShell e codifica texto inserido em HTML.

`stdout` é um canal binário. Um assessment não deve usar `Write-Host`, `Write-Output`, `Write-Warning` ou qualquer outro mecanismo que possa contaminá-lo. Erros destinados ao chamador devem ser eventos de controle sanitizados; detalhes de tenant, tokens, contexto e conteúdo do artefato nunca pertencem a logs ou eventos.
