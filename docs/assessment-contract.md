# Contrato de assessments

O contrato separa a API pública do protocolo interno Node/PowerShell.

## Manifest estático v1

Contrato oficial: `AssessmentManifestSchema` em `packages/contracts/src/assessment-manifest.ts`. JSON UTF-8 de até **64 KiB**, objetos strict em todos os níveis, sem campos desconhecidos, coerção de tipos ou defaults silenciosos. Versões futuras falham fechadas.

| Campo | Regra |
| --- | --- |
| `schemaVersion` | Literal obrigatório `cloudops.assessment.v1` |
| `id`, `moduleId` | 1–64 caracteres; `^[a-z0-9]+(?:-[a-z0-9]+)*$`; ID igual ao nome da pasta |
| `name`, `description` | Obrigatórios, não vazios/em branco; até 100 e 500 caracteres |
| `provider`, `domain` | Enums existentes; devem corresponder ao módulo central |
| `assessmentOrder` | Inteiro 1–999; desempate por ID |
| `enabled`, `visibility` | Boolean obrigatório; `public` ou `development` |
| `engine.runtime` | Somente `powershell` |
| `engine.entrypoint` | 1–240 caracteres, relativo à pasta; arquivo regular `.ps1` existente, sem links/escape |
| `engine.timeoutSeconds` | Inteiro 1–3300; convertido internamente para ms |
| `engine.maxConcurrentExecutions` | Opcional, inteiro 1–100; se ausente mantém limite global |
| `auth.provider` | `none` ou `microsoft-graph` |
| `auth.permissions` | Array obrigatório, único e restrito ao enum Graph existente; `none` exige `[]`, Graph exige ao menos uma |
| `auth.adminConsentRequired` | Boolean obrigatório; `none` exige `false` |
| `display` | Objeto opcional e strict; cada subcampo também é opcional |
| `display.icon` | `users`, `shield`, `link`, `activity`, `key`, `search`, `server`, `database`, `network`, `cost`, `code` |
| `display.tags` | Até seis strings únicas de 1–32 caracteres, sem HTML/controles |
| `display.source` | Texto não vazio de até 120 caracteres, sem HTML/controles ou URL com esquema/`www.` |

Graph continua disponível somente para `azure`, com a allowlist `User.Read`, `User.Read.All`, `AuditLog.Read.All`, `LicenseAssignment.Read.All`. Manifest não concede privilégios nem altera consentimento/OBO. O campo `adminConsentRequired` descreve a ferramenta e não comprova aprovação administrativa.

Entrypoints usam segmentos portáveis ASCII e `/` como separador; não aceitam barras invertidas, espaços, `.`/`..` como segmentos, `%`, drives/UNC, alternate streams ou argumentos. Pastas intermediárias são permitidas dentro do próprio plugin, sem links. Arquivos hard-linked também são rejeitados. O engine root deve ser diretório real; entradas imediatas ligadas por symlink/junction falham mesmo sem manifest. Pastas reais sem `assessment.json` são ignoradas, sem nomes especiais para `shared`/`tests`.

Duplicatas, módulo inexistente/incompatível, JSON malformado, arquivo ausente/não regular, versão desconhecida ou schema inválido impedem startup. Exemplo seguro: `Assessment manifest invalid: inactive-users/assessment.json; field: engine.timeoutSeconds; reason: expected integer from 1 to 3300`.

O [template JSON](examples/assessment.json) documenta todos os campos, inclusive os opcionais; não é descoberto por estar fora de `engine/`. O registry não mantém cópia hardcoded desses valores.

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
  moduleId: string;
  moduleName: string;
  moduleDescription: string;
  moduleOrder: number;
  assessmentOrder: number;
  visibility: "public" | "development";
  requiredAuthProvider: "none" | "microsoft-graph";
  requiredPermissions: readonly ("User.Read" | "User.Read.All" | "AuditLog.Read.All" | "LicenseAssignment.Read.All")[];
  adminConsentRequired: boolean;
  display?: {
    icon?: "users" | "shield" | "link" | "activity" | "key" | "search" | "server" | "database" | "network" | "cost" | "code";
    tags?: readonly string[];
    source?: string;
  };
}
```

Script, caminho, timeout, limite de concorrência por ferramenta e configuração interna não são expostos. `inactive-users` tem timeout de 55 minutos e uma execução simultânea por instância; detalhes em [Usuários inativos](inactive-users.md).

O Module Registry centraliza metadados e valida provider/domain. O catálogo exige IDs únicos e campos de módulo consistentes; ordens são inteiros de 1 a 999. Os campos de módulo já existentes continuam obrigatórios; `display` é uma adição opcional, compatível com catálogos anteriores. Sem display, usa-se ícone genérico do domínio e a fonte anterior. Ícones são SVGs aprovados no código React, nunca markup do manifest; todos os textos são escapados pelo React.

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

`GRAPH_CONSENT_REQUIRED` e `ADMIN_APPROVAL_REQUIRED` são tratados antes da execução no painel de consentimento, separado do ExecutionPanel. Tokens v2 sem `azp` correspondente ao Web autorizado recebem `401 INVALID_API_TOKEN`.

Claims challenge é a única informação de auth propagada em header `WWW-Authenticate`; ele é limitado, validado/codificado, não aparece no JSON e nunca é registrado.
