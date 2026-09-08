# Microsoft Entra — configuração local

Esta etapa usa dois App Registrations independentes:

```text
CloudOps Web Dev  -> SPA pública
CloudOps API Dev  -> API/confidential client e middle tier OBO
```

Ambos devem aceitar **Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)**. Não selecione contas pessoais Microsoft e não fixe um tenant ID no código ou no `.env`.

## 1. CloudOps Web Dev

No **Microsoft Entra admin center**:

```text
Entra ID
-> App registrations
-> New registration
```

Preencha:

```text
Name:
CloudOps Web Dev

Supported account types:
Accounts in any organizational directory
(Any Microsoft Entra ID tenant - Multitenant)

Redirect URI:
Single-page application (SPA)
http://localhost:5173/auth-redirect.html
```

Selecione **Register** e copie o **Application (client) ID**. Ele será `VITE_ENTRA_WEB_CLIENT_ID` e também `CLOUDOPS_ENTRA_WEB_CLIENT_ID` (backend, não secreto).

Em **Authentication**, confirme a plataforma SPA e o redirect URI exato. Não crie client secret para o Web e não habilite implicit grant para esta implementação; MSAL Browser usa authorization code com PKCE e popup.

## 2. CloudOps API Dev

Volte a:

```text
Entra ID
-> App registrations
-> New registration
```

Preencha:

```text
Name:
CloudOps API Dev

Supported account types:
Accounts in any organizational directory
(Any Microsoft Entra ID tenant - Multitenant)
```

Não adicione redirect URI nesse cadastro. Selecione **Register** e copie o **Application (client) ID**. Ele será `CLOUDOPS_ENTRA_API_CLIENT_ID`.

## 3. Expor Assessment.Run

No App Registration **CloudOps API Dev**:

```text
Expose an API
-> Add (Application ID URI)
```

Aceite ou defina exatamente:

```text
api://<API_CLIENT_ID>
```

Depois:

```text
Add a scope

Scope name:
Assessment.Run

Who can consent:
Admins and users

Admin consent display name:
Run CloudOps assessments

Admin consent description:
Allows CloudOps Web to run assessments as the signed-in user.

User consent display name:
Run CloudOps assessments

User consent description:
Allows this app to run CloudOps assessments for you.

State:
Enabled
```

O scope completo usado no browser será:

```text
api://<API_CLIENT_ID>/Assessment.Run
```

Em **Manifest**, confirme que `api.requestedAccessTokenVersion` é `2`.

## 4. Permissões Graph de leitura na API

Ainda em **CloudOps API Dev**:

```text
API permissions
-> Add a permission
-> Microsoft Graph
-> Delegated permissions
-> User.Read
-> User.Read.All
-> AuditLog.Read.All
-> LicenseAssignment.Read.All
-> Add permissions
```

`User.Read` atende ao diagnóstico. As três permissões adicionais são usadas por **Mapear Usuários Inativos** e exigem consentimento administrativo. Não adicione permissões de escrita, `Directory.Read.All`, `Group.Read.All` ou permissões de ferramentas futuras. O usuário executor também precisa das funções de leitura e dos requisitos de licenciamento descritos em [Usuários inativos](inactive-users.md#permissões-e-preparação-do-tenant). Não tente contornar consentimento, Conditional Access ou autorização do usuário.

## 5. Relacionar Web e API

### Permissão do Web para Assessment.Run

No App Registration **CloudOps Web Dev**:

```text
API permissions
-> Add a permission
-> My APIs
-> CloudOps API Dev
-> Delegated permissions
-> Assessment.Run
-> Add permissions
```

O Web precisa somente de `Assessment.Run` na CloudOps API. Não adicione permissões Microsoft Graph diretamente ao SPA.

### knownClientApplications

No App Registration **CloudOps API Dev**, abra **Manifest** e inclua o client ID do Web:

```json
{
  "api": {
    "knownClientApplications": [
      "<WEB_CLIENT_ID>"
    ]
  }
}
```

Preserve os demais campos do manifest. Essa relação permite que o consentimento do client público e da middle-tier API seja apresentado de forma combinada quando aplicável.

Os dois App Registrations da solução devem estar no mesmo tenant de origem; os usuários podem pertencer a outros tenants organizacionais. No onboarding o Web solicita `api://API_ID/.default`. O token normal continua sendo adquirido com `api://API_ID/Assessment.Run`, nunca junto com `.default`. Não adicione Graph ao Web. O modelo segue o [consentimento combinado para OBO](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow).

`.default` é consentimento estático: o popup pode listar as quatro permissões Graph configuradas na API, mesmo ao entrar por outro card. Instalações anteriores com somente `User.Read` precisam de novo consentimento administrativo para o inventário de inativos.

### Pre-authorized application

Se a política do ambiente determinar que o Web deve estar previamente autorizado:

```text
CloudOps API Dev
-> Expose an API
-> Authorized client applications
-> Add a client application

Client ID:
<WEB_CLIENT_ID>

Authorized scopes:
Assessment.Run
```

Isso atualiza `api.preAuthorizedApplications`. Use preauthorization somente com decisão consciente do proprietário do tenant; ela altera a experiência de consentimento, não concede permissões Graph além das configuradas.

## 6. Client secret local

No App Registration **CloudOps API Dev**:

```text
Certificates & secrets
-> Client secrets
-> New client secret
```

Crie uma credencial curta para desenvolvimento. Copie o campo **Value** no momento da criação — não o Secret ID — e grave-o somente no `.env` local:

```dotenv
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<secret value>
```

O `.env` é ignorado pelo Git. O secret entra somente no container da API e nunca em variável `VITE_*`, imagem, frontend, URL ou log.

Em produção, substitua o client secret por certificado ou outro mecanismo confidential-client mais forte. Esta entrega não configura Key Vault nem deployment Azure.

## 7. `.env`

```dotenv
VITE_ENTRA_WEB_CLIENT_ID=<WEB_CLIENT_ID>
VITE_ENTRA_API_SCOPE=api://<API_CLIENT_ID>/Assessment.Run
CLOUDOPS_ENTRA_API_CLIENT_ID=<API_CLIENT_ID>
CLOUDOPS_ENTRA_WEB_CLIENT_ID=<WEB_CLIENT_ID>
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<API_CLIENT_SECRET_VALUE>
```

Não use o Object ID, Tenant ID ou Secret ID nesses campos.

Em instalações existentes, apenas adicione a nova variável backend Web ao `.env`; não recopie o arquivo de exemplo sobre credenciais existentes. `azp` ausente/divergente passa a ser rejeitado. Essa migração é única, não por tenant.

## 8. Validar

```powershell
docker compose up --build
```

Abra `http://localhost:5173`:

1. escolha **Microsoft Azure**;
2. selecione **Entrar com Microsoft**;
3. escolha uma conta work/school;
4. confirme **Authenticated**, Account e Tenant no Dashboard;
5. abra **SecOps → Conectividade e diagnóstico → Microsoft Graph Connectivity**;
6. execute e baixe o ZIP;
7. confirme `report.html` e `summary.json`.

Para **SecOps → Visibilidade de segurança de identidade → Mapear Usuários Inativos**, confira `report.html` e `usuarios-inativos.csv`. Em um tenant de 200 mil usuários, planeje cerca de 41 minutos mais atrasos; mantenha a sessão aberta e baixe o ZIP após a conclusão. Nenhum grant ou `.env` real é alterado automaticamente pela ferramenta.

Para validar multitenancy, repita com duas contas de tenants diferentes, se disponíveis. Cada tenant ainda precisa permitir os apps, consentir as delegated permissions exigidas e autorizar o usuário a acessar os dados solicitados.

## 9. Testar tenant novo ou revogar consentimento antigo

Preferência: use um tenant de laboratório que ainda não tenha consentido CloudOps. A limpeza abaixo é opcional e afeta acesso existente; faça-a apenas no laboratório sob sua administração. **Não exclua App Registrations, service principals, secrets, scopes, `knownClientApplications` ou atribuições de usuários.** Não altere a política do tenant para fazer o teste passar.

### Limpeza de grants, quando necessária

1. Saia do CloudOps, feche suas abas e selecione o diretório de laboratório no Entra admin center.
2. Em **Entra ID → Enterprise apps → All applications**, localize CloudOps Web e CloudOps API pelos respectivos **Application IDs**. Não confunda com Object IDs. Anote os Object IDs locais desses dois service principals e do Microsoft Graph.
3. Em cada app, abra **Permissions → Admin consent**. Revogue somente a concessão Web → API (`Assessment.Run`) e API → Graph (as permissões de leitura CloudOps efetivamente consentidas), usando **… → Revoke permission**. Se não existir grant, não crie um. **User consent** é apenas consultável nessa tela, não revogável pelo portal. [Administração Microsoft](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-application-permissions?pivots=portal).

Para grants de usuário remanescentes, um administrador pode usar **Graph Explorer**, separado do CloudOps, autenticado explicitamente no laboratório. Essa ferramenta administrativa precisa de `DelegatedPermissionGrant.ReadWrite.All`; **não adicione essa permissão aos apps CloudOps**. Liste os grants de cada service principal:

```http
GET https://graph.microsoft.com/v1.0/servicePrincipals/<WEB_SERVICE_PRINCIPAL_OBJECT_ID>/oauth2PermissionGrants
GET https://graph.microsoft.com/v1.0/servicePrincipals/<API_SERVICE_PRINCIPAL_OBJECT_ID>/oauth2PermissionGrants
```

Revise `clientId`, `resourceId`, `scope`, `consentType` e `principalId`: selecione apenas Web → API e API → Graph, referentes à conta de teste (`Principal`) ou concessão organizacional de laboratório (`AllPrincipals`). Não apague grants de outros usuários/recursos. Se houver páginas adicionais, revise-as também. [Listagem oficial](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-oauth2permissiongrants?view=graph-rest-1.0).

Para cada ID previamente conferido, execute individualmente, sem body:

```http
DELETE https://graph.microsoft.com/v1.0/oauth2PermissionGrants/<GRANT_ID_CONFERIDO>
```

Espere `204` e repita as consultas para conferir a ausência dos grants selecionados. A exclusão remove o grant inteiro; se ele contiver permissões além das esperadas, interrompa e revise o escopo. Access tokens já emitidos permanecem válidos até expirar: use uma sessão CloudOps nova, sem tokens antigos. A reversão exige novo consentimento autorizado. [Revogação oficial](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete?view=graph-rest-1.0).

### Aceite sem concessão manual prévia

1. Não use **Grant admin consent** antes do teste. Abra nova janela privada em `http://localhost:5173`.
2. Escolha Azure → **Entrar com Microsoft** ou **Trocar conta**; selecione a conta organizacional do laboratório.
3. Revise o popup combinado. Aceite somente os requisitos esperados da solução. Não altere `.env`, tenant ID ou configuração para cada tenant.
4. Abra **SecOps → Conectividade e diagnóstico → Microsoft Graph Connectivity → Executar**.
5. Se houver consentimento parcial, use **Conceder permissões**. O popup usa `prompt=consent`; a criação é repetida no máximo uma vez.
6. Espere **Concluída / 100%**. Baixe o ZIP e confira `/me`, conta/tenant corretos, `Authentication = Delegated`, `User.Read` e indisponibilidade do segundo download.
7. Valide armazenamento do browser sem tokens/estado OAuth persistidos. Não exporte HAR, traces ou payloads com credenciais reais.
8. Se a política exigir administrador, espere a tela administrativa Microsoft e, quando o erro correspondente voltar à aplicação, `ADMIN_APPROVAL_REQUIRED`. Use a opção de conta administrativa; não contorne a política. Se fechar o popup, pode voltar somente cancelamento — veja [limitação de detecção](authentication.md#recovery-e-aprovação-administrativa).

Se persistir erro após a repetição, revise os IDs Web/API, manifest, consent policy e propagação da configuração. O produto não concede `User.Read` via portal/Graph automaticamente, e a operação não entra em loop.
