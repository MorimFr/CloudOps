# CloudOps v2

CloudOps é a fundação de uma plataforma web para security assessments. Este repositório prova um pipeline real e containerizado entre React, Fastify e PowerShell 7, com artefatos mantidos somente em memória.

Nesta etapa, o único assessment é o `hello-world`: ele não acessa Microsoft Graph e gera um ZIP em memória contendo `report.html` e `summary.json`.

## Arquitetura local

```text
Browser
   -> CloudOps Web (React + Vite, :5173)
   -> CloudOps API (Fastify, :3000)
   -> Assessment Registry
   -> Execution Manager (RAM)
   -> pwsh 7 real
   -> ZIP Buffer (RAM)
   -> download único no Browser
```

Node envia contexto JSON por `stdin`, lê eventos NDJSON de `stderr` e recebe somente bytes do ZIP por `stdout`. O processo é iniciado a partir de um registry interno, sem shell e sem aceitar caminho do cliente.

## Início rápido

Requisito: Docker com Compose v2.

```powershell
docker compose up --build
```

Abra `http://localhost:5173`, execute **Hello World Assessment**, acompanhe o progresso e baixe o relatório.

Portas:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/api/v1/health`

## Como validar

1. Execute `docker compose up --build`.
2. Abra `http://localhost:5173`.
3. Execute o card **Hello World Assessment**.
4. Acompanhe `STARTING -> RUNNING -> COMPLETED` e a barra de progresso.
5. Baixe o ZIP.
6. Confirme que ele contém `report.html` e `summary.json`.
7. Confirme que o artefato não está mais disponível na API depois do download.

## Testes

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Com os containers em execução, valide o pipeline real sem gravar o ZIP em disco:

```powershell
npm run test:e2e
```

Validação direta do engine, sem dependência de Pester:

```powershell
pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```

Se `pwsh` não estiver instalado no host:

```powershell
docker compose run --rm --no-deps cloudops-runtime pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```

## Zero Retention

Execution state e ZIP vivem somente na RAM da API. O artefato é consumido no primeiro download ou eliminado após o TTL de 5 minutos; buffers controlados pela aplicação são zerados em best-effort. O frontend guarda estado somente na memória React e revoga a `Blob URL` após o download.

Não existem banco, Redis, storage, fila persistente ou volumes Docker. O PowerShell usa `MemoryStream`/`ZipArchive` e não cria relatório temporário. O arquivo que o usuário escolhe baixar é a única persistência intencional.

Consulte [Zero Retention](docs/zero-retention.md) para controles e limitações honestas.

## Estrutura principal

```text
apps/
|-- api/                 # Fastify, registry e execution manager em RAM
`-- web/                 # React/Vite e estado efêmero
packages/
`-- contracts/           # tipos e schemas compartilhados
engine/
|-- shared/              # protocolo e segurança PowerShell
|-- hello-world/         # assessment fictício real
`-- tests/               # validação do engine/ZIP em memória
docker/
`-- runtime.Dockerfile   # Node 24.20.0 + PowerShell 7.6.5
docs/
|-- architecture.md
|-- zero-retention.md
|-- assessment-contract.md
|-- assessment-development.md
`-- local-development.md
docker-compose.yml
```

## Documentação

- [Arquitetura](docs/architecture.md)
- [Política de Zero Retention](docs/zero-retention.md)
- [Contrato de assessments](docs/assessment-contract.md)
- [Desenvolvimento de assessments](docs/assessment-development.md)
- [Desenvolvimento local](docs/local-development.md)

## Limitações atuais

Ainda não foram implementados Microsoft Entra, autenticação da API, On-Behalf-Of, Microsoft Graph, assessments reais ou Azure. A próxima camada arquitetural sugerida é Microsoft Entra authentication + CloudOps API authentication + On-Behalf-Of para Graph; ela não faz parte desta entrega.
