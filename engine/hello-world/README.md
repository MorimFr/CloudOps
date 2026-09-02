# Hello World Assessment

Assessment fictício que valida o caminho real `Node.js -> pwsh -> Node.js` sem chamar Microsoft Graph.

Entrada JSON em `stdin`:

```json
{
  "executionId": "EXE-550e8400-e29b-41d4-a716-446655440000",
  "assessmentId": "hello-world",
  "options": {}
}
```

Durante a execução, `stderr` recebe somente eventos NDJSON de progresso e resumo. `stdout` recebe somente um ZIP binário, construído com `MemoryStream` e `ZipArchive`, contendo `report.html` e `summary.json`. O assessment não cria arquivo temporário ou relatório no filesystem.

Para validar diretamente com PowerShell 7:

```powershell
pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```
