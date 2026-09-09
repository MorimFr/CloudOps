# Hello World Assessment

Assessment fictício que valida o caminho real `Node.js -> pwsh -> Node.js` sem chamar Microsoft Graph.

Registrado automaticamente pelo `assessment.json`: `azure/devops/runtime-validation`, visibilidade `development`, auth `none`, timeout 30 segundos. Sem override de concorrência: usa o limite global. O script e seu protocolo não foram alterados pela migração para plugins. Valide a declaração com `npm run assessments:validate`; E2E HTTP sintético com `npm run test:e2e:local` (PowerShell 7 necessário).

Entrada JSON em `stdin`:

```json
{
  "executionId": "EXE-550e8400-e29b-41d4-a716-446655440000",
  "assessmentId": "hello-world",
  "options": {}
}
```

Durante a execução, `stderr` recebe somente eventos NDJSON de progresso e `publicMetrics` estritamente agregadas. `stdout` recebe somente um ZIP binário, construído com `MemoryStream` e `ZipArchive`, contendo `report.html` e `summary.json`. O assessment não cria arquivo temporário ou relatório no filesystem.

Para validar diretamente com PowerShell 7:

```powershell
pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```
