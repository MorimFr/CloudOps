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
- `Retry-After` respeitado com teto;
- backoff exponencial limitado quando o header não existe;
- paginação automática por `@odata.nextLink`, com host pinning, detecção de ciclo e limite de páginas;
- batch de no máximo 20 requests.

Graph headers, bodies e responses não são registrados.

## Processamento incremental

`Get-CloudOpsGraphCollection` emite itens página a página. Assessments futuros devem agregar o necessário e descartar cada página, em vez de manter um tenant inteiro em RAM. Reports devem ser construídos em streams/`ZipArchive` sem fallback para filesystem.

## Erros seguros

- `GRAPH_CONSENT_REQUIRED`
- `GRAPH_INSUFFICIENT_PRIVILEGES`
- `GRAPH_AUTHENTICATION_FAILED`
- `GRAPH_THROTTLED`
- `GRAPH_UNAVAILABLE`
- `AUTH_INTERACTION_REQUIRED`

Nenhum erro retorna body bruto do Graph, token ou claims challenge no JSON.

## Consentimento

CloudOps being multitenant does not bypass Microsoft Entra consent.

Some assessments require delegated permissions that can only be granted by an administrator.

The user must also be authorized to access the requested tenant data.

O assessment atual usa `User.Read`. `Inactive Users`, Privileged Role Auditor, Secure Score e Conditional Access Assessment não fazem parte desta entrega e não justificam permissões antecipadas.

## Testes

`engine/tests/Validate-GraphModule.ps1` usa um `HttpMessageHandler` local, sem rede, e cobre resposta válida, 401, 403, 429/Retry-After, 500/retry, paginação, nextLink host inválido e métricas públicas estritas. O Graph E2E real não roda no CI e deve ser executado manualmente com App Registrations e uma conta autorizada.
