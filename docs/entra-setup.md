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

Selecione **Register** e copie o **Application (client) ID**. Ele será `VITE_ENTRA_WEB_CLIENT_ID`.

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

## 4. Permissão Graph mínima na API

Ainda em **CloudOps API Dev**:

```text
API permissions
-> Add a permission
-> Microsoft Graph
-> Delegated permissions
-> User.Read
-> Add permissions
```

Não adicione `User.Read.All`, `Directory.Read.All`, `Group.Read.All`, `AuditLog.Read.All` ou permissões futuras nesta etapa. Um administrador pode conceder tenant-wide admin consent conforme a política do tenant; não tente contornar consentimento, Conditional Access ou autorização do usuário.

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
CLOUDOPS_ENTRA_API_CLIENT_SECRET=<API_CLIENT_SECRET_VALUE>
```

Não use o Object ID, Tenant ID ou Secret ID nesses campos.

## 8. Validar

```powershell
docker compose up --build
```

Abra `http://localhost:5173`:

1. escolha **Microsoft Azure**;
2. selecione **Entrar com Microsoft**;
3. escolha uma conta work/school;
4. confirme **Authenticated**, Account e Tenant no Dashboard;
5. abra **SecOps → Microsoft Graph Connectivity**;
6. execute e baixe o ZIP;
7. confirme `report.html` e `summary.json`.

Para validar multitenancy, repita com duas contas de tenants diferentes, se disponíveis. Cada tenant ainda precisa permitir os apps, consentir as delegated permissions exigidas e autorizar o usuário a acessar os dados solicitados.
