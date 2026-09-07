# Autenticação e On-Behalf-Of

## Fluxo de confiança

```text
Browser
  -> loginPopup em organizations
  -> access token destinado à CloudOps API
  -> Authorization: Bearer
CloudOps API
  -> assinatura, issuer, tid, audience, exp/nbf e Assessment.Run
  -> ownerKey derivado de tid + oid
  -> OBO tenant-specific
Microsoft Entra
  -> delegated Graph token
PowerShell
  -> Microsoft Graph REST
```

O browser nunca solicita nem recebe o token Graph. Ele conhece apenas o scope `api://<API_CLIENT_ID>/Assessment.Run`. Scopes Graph vêm exclusivamente do Assessment Registry; o request body não pode escolhê-los.

## Browser

MSAL Browser usa:

- authority fixa `https://login.microsoftonline.com/organizations`;
- popup para login, troca de conta e fallback interativo;
- callback de popup isolado e sem scripts em `/auth-redirect.html`;
- `memoryStorage` para tokens e cache temporário OAuth, sem migração ou retenção de cache legado;
- client capability `CP1`;
- nenhuma gravação de bearer token em localStorage, sessionStorage ou IndexedDB.

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
- identificador de usuário `oid`.

Tokens Graph não são aceitos como tokens da CloudOps API.

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

## Conditional Access

Quando OBO retorna interaction required com claims challenge, a API:

1. valida o tenant;
2. limita e codifica o challenge sem registrá-lo;
3. retorna `401 AUTH_INTERACTION_REQUIRED` e `WWW-Authenticate`;
4. o frontend solicita token interativo com `claims` e force refresh;
5. a chamada original é repetida exatamente uma vez.

Autoridade arbitrária não é aceita e um segundo challenge não cria loop.
