# Desenvolvimento local

## Requisitos

- Docker Desktop ou Docker Engine com Compose v2;
- opcionalmente Node.js 24 e npm para execução fora de containers;
- opcionalmente PowerShell 7.2+ para o teste direto do engine.

O Dockerfile desta etapa valida downloads oficiais de PowerShell para arquiteturas `amd64` e `arm64`; outras arquiteturas falham explicitamente durante o build.

Nenhum banco, Redis, storage ou emulador Azure é necessário.

## Iniciar com Docker

Na raiz do repositório:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Copiar o `.env` é opcional porque o Compose já possui defaults seguros. A aplicação fica disponível em:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Health: `http://localhost:3000/api/v1/health`

O Compose não usa volumes. Alterações de código exigem novo build (`docker compose up --build`). Isso evita que o runtime tenha acesso gravável ao workspace do host.

A API usa o build compilado da imagem de runtime, mas o Compose define `NODE_ENV=development` para habilitar CORS exclusivamente para `http://localhost:5173`. A imagem mantém `NODE_ENV=production` como default para um futuro deployment, no qual Web e API deverão ter origem explicitamente configurada.

## Validar o fluxo

1. Abra `http://localhost:5173`.
2. No card **Hello World Assessment**, selecione **Executar**.
3. Observe `STARTING`, os estágios em execução e `COMPLETED`.
4. Selecione **Baixar relatório**.
5. Abra o ZIP escolhido pelo navegador e confirme `report.html` e `summary.json`.
6. Consulte novamente o status: `artifactAvailable` deve ser `false` após o download.

O arquivo baixado é a única persistência intencional e passa a ser responsabilidade do usuário.

## Testes e build locais

```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Sem PowerShell instalado no host, rode a validação do engine na imagem de desenvolvimento:

```powershell
docker compose run --rm --no-deps cloudops-runtime pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```

Com os serviços ativos, o E2E HTTP mantém o ZIP somente em memória e valida o download único:

```powershell
npm run test:e2e
```

## Inspecionar containers

```powershell
docker compose ps
docker compose exec cloudops-runtime node --version
docker compose exec cloudops-runtime pwsh --version
docker compose exec cloudops-runtime id -u
```

As versões esperadas são Node `v24.20.0` e PowerShell `7.6.5`. O UID deve ser diferente de `0`. O serviço `cloudops-runtime` deve aparecer como `healthy`.

## Encerrar

```powershell
docker compose down
```

Como não existem volumes, não há volume de assessment para remover. Restart ou `down` perde toda execução em memória, conforme a política de zero retention.

## Variáveis

| Variável | Default | Uso |
| --- | ---: | --- |
| `PORT` | `3000` | Porta da API dentro do container |
| `WEB_ORIGIN` | `http://localhost:5173` | Única origem CORS local |
| `VITE_CLOUDOPS_API_URL` | `http://localhost:3000` | URL da API usada pelo navegador |
| `ARTIFACT_TTL_SECONDS` | `300` | Vida máxima do artefato concluído em RAM |
| `MAX_CONCURRENT_EXECUTIONS` | `2` | Processos PowerShell simultâneos |

Não coloque secrets no `.env`. A autenticação Microsoft Entra ainda não foi implementada.
