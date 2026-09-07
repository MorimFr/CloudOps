# Validação local da foundation multicloud

Data: 2026-09-07.

A implementação passou pelos gates locais abaixo. O critério de aceite com identidade Microsoft e Microsoft Graph reais continua **pendente**: não foram fornecidos App Registrations nem credenciais reais. Testes sintéticos não são evidência de login, consentimento, Conditional Access ou OBO funcionando em um tenant real.

## Baseline antes das alterações

- 44 testes aprovados.
- Typecheck, lint e build aprovados.
- Docker e E2E Hello World aprovados.

## Resultado final

| Verificação | Resultado |
| --- | --- |
| Instalação local (`npm install --ignore-scripts`) | passed; zero vulnerabilidades reportadas |
| Instalação lockfile no Docker (`npm ci`) | passed; zero vulnerabilidades reportadas |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run test`, Windows | 101 passed; 0 failed |
| `npm run test`, Linux na imagem development sem rede | 101 passed; 0 failed |
| `npm run build`, local e Docker | passed |
| Build final runtime e development via Compose | passed |
| Compose config / up / health | passed com configuração sintética, sem login |
| HTTP health, catálogo anônimo 401, CORS exato, Web e callback popup | passed |
| `Validate-GraphModule.ps1` no runtime final | passed; Graph sintético em memória |
| `Validate-HelloWorld.ps1` no runtime final | passed; PowerShell real e ZIP em RAM |
| E2E HTTP Hello World | passed; JWT RS256 assinado localmente, validador real e PowerShell real |
| `git diff --check` | passed |

Os 101 testes são 6 de contracts, 71 da API e 24 do Web. Incluem validação criptográfica, isolamento por usuário/tenant, OBO/claims challenge, cancelamento/deadline de rede, download único/TTL, redaction e armazenamento MSAL.

O teste de armazenamento usa a biblioteca MSAL real com respostas de identidade sintéticas: login popup, aquisição silenciosa e uma nova instância. Verifica zero chamadas de escrita ao Web Storage e zero abertura de IndexedDB. Não substitui inspeção em um navegador real conectado ao Entra.

Os dois validadores PowerShell rodaram com `--network none`, `--read-only` e `/tmp` em tmpfs. O Hello World verificou contexto stdin, NDJSON stderr, ZIP stdout, conteúdo e ausência de gravações de assessment no workspace e `/tmp`.

O E2E HTTP usou uma chave RSA gerada apenas em memória e o provider de chave do harness de testes. Não houve alteração do servidor de produção, bypass público de autenticação, login Microsoft ou chamada Graph nesse teste. Ele validou o ciclo STARTING → RUNNING → COMPLETED, download e indisponibilidade do segundo download.

## Ambiente e avisos

- Docker Engine 29.7.2; imagem Linux amd64 com Node.js 24.20.0 e PowerShell 7.6.5.
- O frontend compilou com aviso de chunk acima de 500 kB: aproximadamente 640 kB minificado / 179 kB gzip. Não é falha de build.
- O npm avisou sobre dependência transitiva deprecated e política de install scripts; instalação, build e testes passaram.
- Os containers e a rede do projeto temporário `cloudops-validation` foram removidos após os testes; as imagens locais foram mantidas. Nenhum volume de dados foi criado.
- Nenhum `.env` com credenciais reais foi criado; nenhum commit, push, PR ou tag foi realizado.

## Aceite real ainda necessário

Siga [Entra setup](entra-setup.md) e [Desenvolvimento local](local-development.md):

1. Configure CloudOps Web Dev e CloudOps API Dev como multitenant organizacional.
2. Configure o scope Assessment.Run, Graph delegated User.Read e a relação Web/API.
3. Preencha o `.env` local e execute `docker compose up --build`.
4. Entre com conta organizacional e execute Azure → SecOps → Microsoft Graph Connectivity.
5. Valide o `/me` real no ZIP, download único, ausência de tokens Graph no browser e ausência de persistência controlada pelo CloudOps.
6. Repita com outro usuário e, se disponível, outro tenant; valide o isolamento e as políticas de consentimento/Conditional Access.

AWS/GCP não estão conectados. Não foram implementados assessments operacionais, hosting Azure ou Inactive Users Assessment nesta etapa.
