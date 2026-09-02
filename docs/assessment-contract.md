# Contrato de assessments

O contrato separa a API pública do protocolo interno Node.js/PowerShell. Todo assessment futuro deve obedecer aos dois.

## Contrato HTTP

### Identidade e criação

O cliente conhece apenas `assessmentId`:

```ts
interface AssessmentExecutionRequest {
  assessmentId: string;
  options: Record<string, unknown>;
}
```

Na rota `POST /api/v1/assessments/:assessmentId/executions`, o ID da rota é resolvido no registry. O body pode conter somente `options`; caminho, comando e argumento de shell nunca são aceitos. O `executionId` usa aleatoriedade criptográfica no formato `EXE-<UUID>` e não contém dado de tenant.

### Estados

```text
CREATED -> STARTING -> RUNNING -> COMPLETED -> EXPIRED
                         |            |
                         +-> FAILED   +-> download único/limpeza
```

```ts
type ExecutionStatus =
  | "CREATED"
  | "STARTING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED";
```

O status público inclui `executionId`, `assessmentId`, estado, estágio, progresso, timestamps, resumo não sensível, `artifactAvailable` e `expiresAt`. Resultados detalhados nunca fazem parte dessa resposta.

### Endpoints

- `GET /api/v1/health`: saúde da API e disponibilidade cacheada do executável PowerShell.
- `GET /api/v1/assessments`: catálogo público, sem caminho de script.
- `POST /api/v1/assessments/:assessmentId/executions`: inicia execução em memória.
- `GET /api/v1/executions/:executionId`: retorna metadados sanitizados.
- `GET /api/v1/executions/:executionId/artifact`: download único do ZIP.

O download retorna `application/zip`, `Content-Disposition: attachment` e headers `no-store/no-cache`. Depois de entregue, o Buffer é limpo e deixa de estar disponível. O TTL aplica a mesma limpeza se não houver download.

Erros públicos usam um código estável e uma mensagem genérica:

```json
{
  "error": {
    "code": "ASSESSMENT_EXECUTION_FAILED",
    "message": "The assessment could not be completed."
  }
}
```

Stack, ambiente, caminhos internos e conteúdo dos canais não são retornados.

## Protocolo Node.js -> PowerShell

O runtime inicia somente o script já resolvido no registry:

```text
pwsh -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <approved-script>
```

Não há `shell: true` nem concatenação de input em linha de comando.

### stdin: contexto JSON único

```json
{
  "executionId": "EXE-550e8400-e29b-41d4-a716-446655440000",
  "assessmentId": "hello-world",
  "options": {}
}
```

O stream é fechado após a escrita. O contexto não pode ser logado ou persistido. Um token transitório poderá ser acrescentado em etapa futura, mantendo essas regras.

### stderr: controle NDJSON

Cada linha é um objeto JSON completo e pequeno:

```json
{"type":"progress","stage":"PROCESSING","progress":55}
{"type":"summary","summary":{"message":"Assessment completed successfully.","findings":0}}
```

Um evento de erro é sanitizado:

```json
{"type":"error","code":"ASSESSMENT_FAILED","message":"The assessment could not be completed."}
```

Eventos não podem incluir tokens, opções, resposta Graph, findings detalhados ou PII. O parser impõe limite e schema; linha inválida falha de modo controlado sem ecoar seu conteúdo.

### stdout: artefato binário

`stdout` é reservado integralmente ao ZIP. O assessment não pode emitir log, debug, warning ou objeto PowerShell nesse canal. O Node consome chunks binários sem conversão de encoding e só disponibiliza o Buffer se processo, protocolo e ZIP forem aceitos.

## Falha, timeout e capacidade

- Processo com código diferente de zero, evento inválido ou artefato vazio resulta em `FAILED` e limpeza.
- O timeout padrão do Hello World é 30 segundos; ao expirar, o processo é encerrado e buffers são descartados.
- A concorrência padrão é 2. Ao atingir o limite, a API responde `EXECUTION_CAPACITY_REACHED`; não existe fila persistente.
