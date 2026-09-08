# Microsoft Graph

## Modelo delegated

CloudOps usa Microsoft Graph delegated access: o token OBO representa o usuário autenticado naquele tenant. A aplicação não ganha automaticamente acesso que o usuário, as permissões consentidas ou as políticas do tenant não permitam.

O primeiro assessment exige somente `User.Read` e consulta:

```http
GET https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName
```

Dados do principal e tenant aparecem apenas em `report.html`/`summary.json` dentro do ZIP escolhido pelo usuário. A resposta pública contém somente `graphReachable` e `requestsCompleted`.

## Permission registry

Cada assessment declara `requiredAuthProvider` e uma allowlist de `requiredPermissions`. A API ignora qualquer tentativa do cliente de fornecer scopes. Adicionar uma nova permissão Graph exige mudança revisada no contrato e no registry, seguida da configuração correspondente no App Registration.

## CloudOps.Graph.psm1

O engine usa REST diretamente, sem Microsoft.Graph PowerShell SDK:

- base fixa `https://graph.microsoft.com/v1.0`;
- host, HTTPS, porta, userinfo, fragment e prefixo de versão validados;
- redirects e cookies desabilitados;
- `Authorization: Bearer` e `Accept: application/json`;
- responses com limite de bytes e buffers limpos best-effort;
- `401`/`403` normalizados sem ler/refletir body de erro;
- retry limitado para `429`, `500`, `502`, `503` e `504`;
- `Retry-After` respeitado integralmente; valores acima do orçamento permitido causam falha segura, nunca retry antecipado;
- backoff exponencial limitado quando o header não existe;
- paginação automática por `@odata.nextLink`, com host pinning, detecção de ciclo e limite de páginas;
- batch de no máximo 20 requests.

Graph headers, bodies e responses não são registrados.

## Processamento incremental

`Get-CloudOpsGraphCollection` emite itens página a página. Assessments futuros devem agregar o necessário e descartar cada página, em vez de manter um tenant inteiro em RAM. Reports devem ser construídos em streams/`ZipArchive` sem fallback para filesystem.

`inactive-users` já usa esse modelo: `$top=500` com `signInActivity`, uma conexão HTTP reutilizada, espera entre páginas, contadores e CSV diretamente no ZIP. O callback interno de página recebe somente seu número; métricas públicas agregadas são atualizadas durante a execução. Consulte [dimensionamento para 200 mil usuários](inactive-users.md#grandes-ambientes-referência-de-200-mil-usuários).

## Erros seguros

- `GRAPH_CONSENT_REQUIRED`
- `ADMIN_APPROVAL_REQUIRED` (consentimento no Entra/OBO, antes do engine)
- `GRAPH_INSUFFICIENT_PRIVILEGES`
- `GRAPH_AUTHENTICATION_FAILED`
- `GRAPH_THROTTLED`
- `GRAPH_UNAVAILABLE`
- `AUTH_INTERACTION_REQUIRED`

Nenhum erro retorna body bruto do Graph, token ou claims challenge no JSON.

## Consentimento

Ser multitenant não contorna consentimento nem autorização do usuário. O Web usa `api://API_ID/.default` somente no onboarding/reconsentimento combinado, com o Web listado em `api.knownClientApplications` da API. As chamadas normais continuam com `Assessment.Run`; OBO adquire somente os scopes Graph de leitura registrados para a ferramenta. O browser nunca recebe token Graph.

`.default` solicita consentimento estático conforme as permissões configuradas na API, não um conjunto dinâmico escolhido pelo card. Adicionar Graph permissions futuras pode exigir novo consentimento nos tenants existentes. Não misture `.default` e `Assessment.Run` na mesma solicitação.

`GRAPH_CONSENT_REQUIRED` abre o painel de permissões separado do drawer; o usuário pode consentir pelo popup Microsoft e repetir a criação uma vez com token normal renovado. Sinais explícitos de aprovação administrativa produzem `ADMIN_APPROVAL_REQUIRED`, sem grants automáticos. Cancelamento ou falha não cria loop. Um `403` genérico do Graph continua `GRAPH_INSUFFICIENT_PRIVILEGES`, pois não prova ausência de consentimento administrativo.

Veja [fluxo e limites de detecção](authentication.md#recovery-e-aprovação-administrativa) e [teste em tenant novo](entra-setup.md#9-testar-tenant-novo-ou-revogar-consentimento-antigo).

Graph Connectivity continua usando apenas `User.Read`. Mapear Usuários Inativos usa `User.Read`, `User.Read.All`, `AuditLog.Read.All` e `LicenseAssignment.Read.All`, com consentimento administrativo. Privileged Role Auditor, Secure Score e Conditional Access Assessment continuam fora desta entrega e não justificam permissões antecipadas.

No catálogo, Graph Connectivity permanece público em `azure → secops → connectivity-diagnostics`. É diagnóstico de conectividade, não avaliação de postura de segurança. Seus limites e o caminho Graph token → stdin → PowerShell RAM permanecem preservados. A ferramenta de inativos fica em `identity-visibility` e tem limites próprios documentados.

## Testes

`engine/tests/Validate-GraphModule.ps1` usa um `HttpMessageHandler` local, sem rede, e cobre resposta válida, 401, 403, 429/Retry-After, 500/retry, paginação, nextLink host inválido e métricas públicas estritas. O Graph E2E real não roda no CI e deve ser executado manualmente com App Registrations e uma conta autorizada.
