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

Antes, metadados de cada ferramenta eram uma lista fixa no código. Agora a declaração oficial de cada assessment é `engine/<id>/assessment.json`; não existe uma segunda lista de registrations. No startup:

```text
loadConfig → engineRoot → discovery de pastas imediatas
  → schema estrito e arquivos seguros → validação do ModuleRegistry
  → AssessmentRegistry → Fastify → catálogo autenticado → card genérico
```

`assessment-discovery.ts` lê JSON limitado a 64 KiB, valida versão, ID/pasta e entrypoint. Não abre o conteúdo dos scripts nem executa/importa PowerShell. `AssessmentManifestSchema` reside em contracts. `AssessmentRegistry` recebe os resultados validados, confere módulos, constrói o registro interno e projeta somente metadados públicos. A descoberta termina antes da criação dos serviços da API; qualquer manifest inválido impede o startup.

O registry resultante resolve:

- script aprovado;
- provider/domain/module/visibility e ordem;
- auth provider;
- delegated Graph permissions;
- timeout/habilitação.

`timeoutSeconds` vira milissegundos somente no registro interno; concorrência opcional preserva o fallback global. `ModuleRegistry` continua central: nomes, descrição e ordem dos módulos não pertencem aos manifests. O frontend recebe `display` opcional (ícone por allowlist, tags e fonte textual), sem entrypoint, paths, timeout ou configuração interna. Nenhum assessment ID é usado para escolher sua apresentação.

A descoberta ocorre uma vez por inicialização, ordenada por nome da pasta, sem recursão de manifests, watcher, banco ou instalação dinâmica. Uma pasta nova/removida só altera o catálogo após restart; imagens Docker precisam de rebuild/redeploy. `CLOUDOPS_ENGINE_ROOT` é configuração do servidor, nunca parâmetro do cliente; testes usam raízes temporárias sintéticas.

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
- Manifests/scripts pertencem ao build confiável e imutável. Schema valida declaração e contenção de paths, não a segurança do código PowerShell. Revisão e testes do código continuam obrigatórios; não é sandbox para plugins de terceiros.
- Entry points são `.ps1` regulares, relativos e contidos na própria pasta e no engine root; caminhos absolutos, traversal, argumentos de shell, symlinks/junctions e hard links de arquivos são rejeitados. Nenhum comando é construído a partir de texto do manifest; o runtime existente mantém `shell:false`.
- Erros de manifest mostram somente path relativo seguro, campo conhecido e motivo fixo; não refletem valores, chaves desconhecidas, filesystem absoluto ou stacks em produção.

Para detalhes, consulte [authentication.md](authentication.md), [microsoft-graph.md](microsoft-graph.md) e [zero-retention.md](zero-retention.md).
