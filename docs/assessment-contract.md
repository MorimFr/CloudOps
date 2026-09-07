# Contrato de assessments

O contrato separa a API pública do protocolo interno Node/PowerShell.

## Catálogo

`GET /api/v1/assessments` exige Bearer token e publica somente:

```ts
interface AssessmentSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  provider: "azure" | "aws" | "gcp";
  domain: "dashboard" | "govops" | "secops" | "finops" | "devops";
  visibility: "public" | "development";
  requiredAuthProvider: "none" | "microsoft-graph";
  requiredPermissions: readonly "User.Read"[];
  adminConsentRequired: boolean;
}
```

Script, caminho, timeout e configuração interna não são expostos.

## Criação

```http
POST /api/v1/assessments/:assessmentId/executions
Authorization: Bearer <CloudOps API token>
Content-Type: application/json

{"options":{}}
```

O ID é resolvido exclusivamente no registry. O body não aceita path, command, token, tenant, auth, Graph scope ou chaves reservadas. O `executionId` é `EXE-<UUID v4>`.

## Estado público

```ts
interface Execution {
  executionId: string;
  assessmentId: string;
  status: "CREATED" | "STARTING" | "RUNNING" | "COMPLETED" | "FAILED" | "EXPIRED";
  stage: string | null;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  publicMetrics?: {
    findings?: number;
    objectsAnalyzed?: number;
    requestsCompleted?: number;
    graphReachable?: boolean;
  };
  artifactAvailable: boolean;
  expiresAt: string | null;
}
```

`publicMetrics` é strict e permite somente inteiros agregados não negativos/seguros e boolean. UPN, e-mail, displayName, IDs de objeto, tenant, nomes, evidência, finding detalhado e Graph response são proibidos.

## Endpoints

- `GET /api/v1/health`: único endpoint público.
- `GET /api/v1/assessments`: catálogo autenticado.
- `POST /api/v1/assessments/:assessmentId/executions`: criação autenticada.
- `GET /api/v1/executions/:executionId`: status do mesmo owner.
- `GET /api/v1/executions/:executionId/artifact`: download único do mesmo owner.
- `DELETE /api/v1/executions/:executionId`: cancelamento do mesmo owner.

Outro usuário recebe `404`, inclusive para status, download e cancelamento.

## Contexto interno em stdin

Hello World:

```json
{
  "executionId": "EXE-550e8400-e29b-41d4-a716-446655440000",
  "assessmentId": "hello-world",
  "options": {}
}
```

Assessment Graph:

```json
{
  "executionId": "EXE-550e8400-e29b-41d4-a716-446655440000",
  "assessmentId": "microsoft-graph-connectivity",
  "options": {},
  "auth": {
    "provider": "microsoft-graph",
    "tenantId": "<validated tid>",
    "accessToken": "<transient Graph token>"
  }
}
```

Esse segundo objeto nunca é API pública, estado de execution ou log. O token existe somente durante a passagem para o processo.

## Controle em stderr

Cada linha é NDJSON pequeno e validado:

```json
{"type":"progress","stage":"QUERYING_GRAPH","progress":55}
{"type":"publicMetrics","publicMetrics":{"graphReachable":true,"requestsCompleted":1}}
{"type":"error","code":"GRAPH_UNAVAILABLE","message":"Microsoft Graph is temporarily unavailable."}
```

O runtime aplica schema, tamanho e monotonicidade. Texto arbitrário, propriedades extras e eventos inválidos falham fechados sem ecoar conteúdo.

## Artefato em stdout

`stdout` contém somente um ZIP binário. O runtime lê chunks com limite configurável, sem conversão de texto e sem arquivo temporário. O download:

- usa `application/zip`;
- envia headers `no-store/no-cache`;
- transfere uma lease do Buffer;
- sobrescreve o Buffer após conclusão/fechamento;
- não fica disponível para segundo download.

## Erros

Erros HTTP usam envelope estrito com código estável e mensagem segura. Stack, resposta Graph, detalhe MSAL, secret, token, claims e ambiente nunca são refletidos.

Claims challenge é a única informação de auth propagada em header `WWW-Authenticate`; ele é limitado, validado/codificado, não aparece no JSON e nunca é registrado.
