# Autenticação e On-Behalf-Of

## Fluxo de confiança

```text
Browser
  -> loginPopup em organizations com api://API_ID/.default (consentimento)
  -> acquireTokenSilent com api://API_ID/Assessment.Run (chamadas HTTP)
  -> access token destinado à CloudOps API
  -> Authorization: Bearer
CloudOps API
  -> assinatura, issuer, tid, audience, exp/nbf, azp do Web e Assessment.Run
  -> ownerKey derivado de tid + oid
  -> OBO tenant-specific
Microsoft Entra
  -> delegated Graph token
PowerShell
  -> Microsoft Graph REST
```

O browser nunca solicita nem recebe token Graph. Os dois scopes conhecidos pelo browser pertencem à CloudOps API. Scopes Graph vêm exclusivamente do Assessment Registry; o request body não pode escolhê-los.

## Dois contextos de scope

| Contexto | Scope | Uso |
| --- | --- | --- |
| Token normal | `api://API_ID/Assessment.Run` | Todas as chamadas de catálogo, criação, status, cancelamento e download; silent e fallback interativo |
| Consentimento combinado | `api://API_ID/.default` | Login/troca de conta e reconsentimento explícito com `prompt=consent` |

`deriveCombinedConsentScope` valida o formato GUID do recurso e deriva `.default` de `VITE_ENTRA_API_SCOPE`; não existe variável duplicada. Nunca passamos `.default` e `Assessment.Run` juntos nem solicitamos scopes Graph no SPA. Os scopes OIDC internos do MSAL continuam a cargo da biblioteca.

O Web mantém a permissão delegada `Assessment.Run`; a API mantém Graph delegado `User.Read`, `User.Read.All`, `AuditLog.Read.All` e `LicenseAssignment.Read.All` e lista o Web em `api.knownClientApplications`. OBO pede apenas as permissões do assessment registrado. A relação habilita o consentimento combinado no fluxo OBO. `.default` considera todas as permissões estáticas configuradas: a inclusão do inventário de inativos exige novo consentimento administrativo onde faltarem as permissões. [Modelo oficial Microsoft](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow).

## Browser

MSAL Browser usa:

- authority fixa `https://login.microsoftonline.com/organizations`;
- popup para login, troca de conta e fallback interativo;
- callback de popup isolado e sem scripts em `/auth-redirect.html`;
- `memoryStorage` para tokens e cache temporário OAuth, sem migração ou retenção de cache legado;
- client capability `CP1`;
- nenhuma gravação de bearer token em localStorage, sessionStorage ou IndexedDB.

No desenvolvimento, middleware específico serve o HTML estático do callback antes da transformação do Vite, impedindo injeção de HMR/React Refresh nessa página. O build de produção também mantém o callback sem scripts. Um teste de navegador cobre a resposta real do servidor, `no-store` e `no-referrer`.

Usamos MSAL Browser `4.30.0` e MSAL React `3.0.29`, das linhas LTS oficialmente suportadas. A opção pública `temporaryCacheLocation` ainda existe nessa linha e é definida como `MemoryStorage`; a v5 removeu essa opção e fixa o cache temporário em Session Storage. A atualização para v5 fica condicionada a um mecanismo suportado que preserve a política do projeto. O teste com a biblioteca real simula popup e aquisição silenciosa e verifica ausência de gravações persistentes. [Suporte de versões Microsoft](https://github.com/AzureAD/microsoft-authentication-library-for-js#library-version-support-status).

Trocar conta usa `prompt=select_account`. Logout/troca incrementa a época da sessão e desmonta o estado React do catálogo/execution.

## Validação da API

A API baixa metadata e JWKS somente dos endpoints Microsoft `organizations` fixos, limita tamanho/timeout e mantém chaves apenas em memória. Antes de aceitar um token, exige:

- JWT assinado em `RS256` por uma chave Microsoft compatível com o tenant;
- `tid` GUID organizacional e não o tenant de contas pessoais;
- issuer exato `https://login.microsoftonline.com/<tid>/v2.0`;
- audience igual ao client ID da CloudOps API;
- access token v2 válido no tempo;
- scope delegado `Assessment.Run`;
- `azp` igual ao `CLOUDOPS_ENTRA_WEB_CLIENT_ID`, GUID não secreto definido no backend;
- identificador de usuário `oid`.

Tokens Graph não são aceitos como tokens da CloudOps API.

`azp` ausente ou diferente retorna `401 INVALID_API_TOKEN`, sem registrar o valor recebido. O backend não lê `VITE_ENTRA_WEB_CLIENT_ID`; o operador configura os dois IDs Web com o mesmo valor. Web e API continuam apps distintos.

## Ownership

O owner de uma execução é derivado de `tid + oid` autenticados e convertido em uma chave HMAC/hash não reversível para estado interno. O cliente nunca envia owner. Status, cancelamento e download retornam `404` para outro owner, evitando enumeração.

## OBO

Para um assessment `microsoft-graph`, a API chama o confidential client MSAL com:

- assertion: access token recebido pela API;
- authority construída internamente com o `tid` já validado;
- scopes obtidos do registry;
- client ID e client secret do App Registration da API.

O token Graph fica somente na RAM e é enviado ao processo PowerShell pelo `stdin`. Ele nunca entra em `ExecutionState`, publicMetrics, resposta HTTP ou log.

A reserva de capacidade para OBO possui deadline configurável (`OBO_TIMEOUT_SECONDS`, 15 segundos por padrão). O adapter HTTP do MSAL aceita cancelamento, fixa o host Microsoft, proíbe redirects/cookies e limita a resposta a 1 MiB. Timeout ou shutdown abortam a chamada; o estado reservado é removido e a API devolve apenas `GRAPH_UNAVAILABLE`. O client MSAL continua efêmero, usa `skipCache` e limpa seu cache ao terminar. Respostas tardias não iniciam o engine.

## Consentimento e autorização

CloudOps ser multitenant não contorna consentimento Microsoft Entra. Alguns assessments exigirão delegated permissions que somente um administrador pode conceder. O usuário também deve estar autorizado a acessar os dados solicitados no tenant.

`403` do Graph é normalizado genericamente porque pode significar permissão delegada ausente, consentimento ausente ou falta de role/autorização do usuário.

## Recovery e aprovação administrativa

`useAssessmentLaunch` mantém quatro estados de permissão: `READY`, `CONSENT_REQUIRED`, `ADMIN_APPROVAL_REQUIRED` e `INTERACTION_REQUIRED`. São estado transitório de UX, não prova de autorização prévia; o servidor sempre autoriza a execução.

Ao receber `GRAPH_CONSENT_REQUIRED`, não inicia engine nem abre o ExecutionPanel. `ConsentRequiredPanel` mostra requisitos e aguarda **Conceder permissões**. O clique abre `acquireTokenPopup({ scopes: [combinedConsentScope], prompt: "consent" })`, fixado na conta/tenant atuais. Depois, adquire novamente `Assessment.Run` com `forceRefresh` e repete a criação uma única vez. Não reutiliza o token retornado pelo consentimento como resultado do hook nem o coloca no estado React.

CA e consent recovery compartilham o orçamento de uma repetição HTTP por operação: no máximo duas tentativas de criação. Falha/cancelamento do popup não inicia execução; falha após a repetição bloqueia nova repetição automática. Fechar o diálogo e escolher Executar é uma nova intenção explícita. Mudança de conta/sessão invalida o recovery anterior; não repete execução sob outra identidade.

Erros Microsoft conhecidos `AADSTS90094`, `AADSTS90095` ou `admin_consent_required` tornam-se `ADMIN_APPROVAL_REQUIRED`, tanto no login quanto no OBO/reconsentimento. A UI oferece **Tentar com uma conta administrativa**, sem conceder privilégios nem executar como o usuário anterior. O administrador precisa ter autoridade no tenant e cumprir as políticas Microsoft. Nenhuma chamada para criar grants é feita pelo CloudOps. [Códigos oficiais](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes).

Limitação: a Microsoft pode manter a exigência administrativa dentro do próprio popup. Se o usuário apenas fechá-lo, o MSAL pode retornar somente `user_cancelled`; não há evidência segura para deduzir admin consent. Nesse caso mostramos cancelamento seguro, não inventamos um código administrativo. `403` genérico do Graph também não é presumido admin-only.

## Conditional Access

Quando OBO retorna interaction required com claims challenge, a API:

1. valida o tenant;
2. limita e codifica o challenge sem registrá-lo;
3. retorna `401 AUTH_INTERACTION_REQUIRED` e `WWW-Authenticate`;
4. o frontend solicita token interativo com `claims` e force refresh;
5. a chamada original é repetida exatamente uma vez.

Autoridade arbitrária não é aceita e um segundo challenge não cria loop.
