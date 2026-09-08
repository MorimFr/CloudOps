# Arquitetura do CloudOps v2

## Visão geral

```text
CloudOps Web
  React Router + MSAL Browser
        |
        | CloudOps API access token
        v
CloudOps API
  Entra JWT validation + owner isolation
        |
        | OBO somente quando o registry exige Graph
        v
Microsoft Entra / Microsoft Graph
        |
        | Graph token transitório via stdin
        v
PowerShell 7 Assessment Engine
        |
        | NDJSON em stderr + ZIP binário em stdout
        v
Execution Manager (RAM)
        |
        | download único
        v
Browser
```

Web e API são serviços separados. A imagem da API inclui Node 24, PowerShell 7 e o engine; `pwsh` é iniciado diretamente, sem shell intermediário, como usuário não privilegiado.

## Web

A rota é a fonte de estado do provider e domínio. O Cloud Selector leva aos shells Azure, AWS e GCP, cada um com Dashboard, GovOps, SecOps, FinOps e DevOps.

Para Azure, MSAL autentica contas work/school pela authority `organizations`. O cache usa somente memória. O frontend solicita o scope da CloudOps API, injeta o Bearer token num cliente central e nunca recebe token Microsoft Graph.

O catálogo é carregado depois da autenticação e filtrado dinamicamente pelos metadados do registry. Estado de sessão, account, tenant, execution e Blob URL fica somente na memória da página.

O catálogo segue `provider → domain → module → assessment`, com Module Registry central, ordenação determinística e temas por provider. Consentimento combinado (`.default`) ocorre em popup separado do token normal (`Assessment.Run`). Recovery e aprovação administrativa ficam em diálogo próprio; não alteram o ExecutionPanel aprovado.

## API e boundary de autenticação

Somente `GET /api/v1/health` é público. O hook Entra protege todas as rotas de assessment/execution; handlers também exigem explicitamente a identidade quando usam estado.

O validator aceita somente access token v2:

- assinado em RS256 por uma chave obtida dos endpoints Microsoft fixos de `organizations`;
- issuer tenant-specific consistente com o `tid` GUID validado;
- audience do App Registration CloudOps API;
- dentro da validade temporal;
- com delegated scope `Assessment.Run`;
- com `azp` do Web autorizado (`CLOUDOPS_ENTRA_WEB_CLIENT_ID`);
- com `oid` de usuário.

Metadata/JWKS têm timeout, limite de tamanho e cache apenas em memória.

## Ownership de execução

A API deriva o owner de `tid + oid` autenticados. Esse valor não é aceito no body nem exposto. Cada GET, cancelamento e download compara a chave de owner em tempo constante e responde como não encontrado a outro usuário.

Um restart perde todas as executions por design.

## Registry e OBO

O Assessment Registry é a única origem para:

- script aprovado;
- provider/domain/module/visibility e ordem;
- auth provider;
- delegated Graph permissions;
- timeout/habilitação.

O cliente envia apenas `assessmentId` e `options`. Paths, commands, tenant, access token e Graph scopes não são aceitos.

Quando `requiredAuthProvider` é `microsoft-graph`, a API usa OBO com a assertion recebida, authority construída a partir do tenant validado e scopes do registry. O Graph token não entra no estado da execution.

## Runtime PowerShell

```text
stdin   -> contexto JSON único
stderr  -> eventos NDJSON validados
stdout  -> ZIP binário e nada mais
```

O contexto Graph existe apenas para assessments que o exigem. O processo recebe limites de contexto, stderr, artefato e timeout. Saída inválida, tamanho excedido ou falha causa descarte e erro público sanitizado.

`CloudOps.Graph.psm1` chama REST `v1.0` com host pinning, redirect desabilitado, retry limitado, Retry-After, paginação validada e response size bound. Não há Microsoft.Graph PowerShell SDK.

## Ciclo de execução

```text
STARTING
  -> OBO (quando necessário)
  -> RUNNING + progress
  -> COMPLETED + ZIP Buffer em RAM
  -> download único ou TTL
  -> wipe best-effort
  -> remoção

Falha/cancelamento
  -> abort do processo
  -> wipe best-effort
  -> remoção/estado terminal temporário
```

O status público carrega somente metadados operacionais e `publicMetrics` agregadas por allowlist. Identidade, tenant, Graph response e evidências ficam no ZIP.

## Limites de confiança

- CORS aceita apenas a origem exata configurada e não usa credentials.
- Logs não recebem headers, body, contexto, claims challenge, tokens, Graph payload ou artefato.
- O runtime Compose é read-only, sem capabilities e sem volumes de dados.
- `/tmp` é tmpfs pequeno para necessidades internas do runtime, nunca fallback de assessment.
- Wipe de memória gerenciada é best-effort, não garantia criptográfica.

Para detalhes, consulte [authentication.md](authentication.md), [microsoft-graph.md](microsoft-graph.md) e [zero-retention.md](zero-retention.md).
