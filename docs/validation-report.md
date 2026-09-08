# Validação — Mapear Usuários Inativos e histórico da foundation

## Revisão da classificação e evidências — 2026-09-08

Classificação v2: histórico de atividade omitido/nulo na consulta selecionada usa a carência de criação, sem afirmar “nunca entrou”; histórico legado de tentativas antigas recebe evidência separada; tentativas recentes sem campo de sucesso continuam indeterminadas. Último sucesso conhecido mantém prioridade. Criação ausente/malformada não invalida sucesso utilizável; dados contraditórios e datas realmente futuras permanecem indeterminados. Corte UTC fixo e instante de observação separados corrigem logins ocorridos durante a coleta.

HTML acrescenta cobertura dos campos, três categorias de evidência dos inativos, motivos principais dos indeterminados, alertas complementares e até 50 contas para investigação. CSV preserva exatamente oito colunas e somente inativos. Nenhuma consulta por usuário foi adicionada. Os detalhes e limites estão em [Usuários inativos](inactive-users.md).

Verificações desta revisão:

- **146 testes unitários aprovados**: contracts 8, API 85, Web 53. Typecheck, lint e build aprovados. Persiste o aviso anterior, não bloqueante, de chunk frontend acima de 500 kB.
- **4 testes do HTML aprovados**: 1440, 768 e 390 px, mais impressão; sete gráficos, totais de evidências/motivos conciliados, amostras, escape de conteúdo e zero requisições externas.
- Validadores PowerShell 7 de Graph, Hello World e Inativos aprovados em containers read-only, sem rede, usando o engine atual montado somente para leitura. As imagens locais da aplicação não foram substituídas.
- Casos novos: omissão vs. null vs. schema inválido, ausência de seleção explícita, corte e carência exatos, sucesso/criação durante a coleta, criação malformada com sucesso válido, datas inválidas/futuras, arrays que não podem virar datas/nulos, tentativas antigas/recentes, amostra de indeterminados limitada a 50 e aviso de cobertura para população inteira sem histórico. Erro 403 e falha tardia continuam descartando o ZIP parcial; snapshots de arquivos permanecem iguais.
- **200.000 contas sintéticas, 400 páginas de usuários e 402 consultas totais; 200.000 linhas CSV verificadas**, alternando quatro formatos de histórico. ZIP: 1.119.884 bytes; processamento: 172,9 segundos; pico de working set do processo de teste: 335,0 MiB. Rede e esperas foram simuladas. Não comparar diretamente com a rodada anterior (fixture diferente), nem interpretar como desempenho/SLA do Graph real.

O Docker Desktop foi iniciado para os testes; containers temporários usam remoção automática. Não foram executados login ou leitura de tenant real, nem alterados grants, credenciais ou `.env`. Sem commit/push. Para usar a nova lógica em Compose, em momento sem execução ativa, reconstrua/recrie `cloudops-runtime` e execute novamente a ferramenta: arquivos já baixados não são reclassificados. O teste de tenant real, inclusive os 515 indeterminados do relatório anterior, continua dependendo de uma nova coleta do administrador.

## Mapear Usuários Inativos — 2026-09-07

Baseline desta ferramenta: 140 testes unitários e 18 regressões de navegador. Resultado após implementação: **146 testes unitários aprovados** (contracts 8, API 85, Web 53), **18 testes de UI aprovados** e **4 testes do HTML offline aprovados** (1440, 768 e 390 px; impressão). Typecheck, lint e build local aprovados. Build da imagem isolada `cloudops-inactive-validation:local` aprovado; `npm ci`/prune reportaram zero vulnerabilidades. Persiste aviso não bloqueante de chunk frontend acima de 500 kB; não foram adicionadas bibliotecas de gráficos.

Validação PowerShell 7 em containers sem rede e read-only:

- Graph: retries, `Retry-After` longo sem antecipação, falha quando excede orçamento, paginação, formato de coleção e host pinning.
- Hello World: stdin, NDJSON, ZIP em memória e snapshots sem gravação de assessment.
- Inativos: limite exato de 90 dias, carência de criação, tentativas malsucedidas, dados indeterminados, convidados, licenças múltiplas/desconhecidas, CSV protegido contra fórmulas, HTML contra injeção, BOM, gráficos vazios, duplicatas, limites e falha tardia descartando ZIP parcial. Wrapper real recebe stdin e produz ZIP binário com Graph sintético; rejeita opções/contextos inválidos antes da coleta. Snapshots/hashes de engine e `/tmp` permanecem iguais (excluindo sockets/FIFOs e o cache de timing de inicialização do próprio PowerShell).

Teste de escala: **200.000 contas sintéticas, 400 páginas de usuários e 402 consultas totais, 200.000 linhas CSV verificadas**. ZIP de 1.075.529 bytes; 472,0 segundos de processamento; pico de working set de 312,8 MiB do processo de teste. Páginas foram geradas sob demanda, com rede e esperas simuladas; não são medidas de desempenho do Graph nem dimensionamento garantido para qualquer combinação de licenças. O HTML permanece limitado à amostra de 50 contas e agregados. Estimativa operacional para o tenant real: cerca de 41 minutos mais atrasos, com timeout de 55 minutos e validade da autenticação como condição.

Integração API usa registry real e broker/runtime sintéticos para conferir scopes, tenant, ownership, download único, limites de concorrência e métricas durante a coleta. O painel aprovado não foi redesenhado. Os testes reais Entra/Graph da nova ferramenta **não foram executados**: dependem de consentimento administrativo, requisitos P1/P2 e funções do usuário. Os containers locais que já estavam em uso e o `.env` real foram preservados; a versão nova precisa ser carregada com rebuild/recriação em momento sem execução ativa. Não houve commit, push ou alteração de grants.

Regras, permissões, limites e comandos de teste em [Usuários inativos](inactive-users.md).

## Histórico — consent foundation e catálogo modular

Data: 2026-09-07.

A foundation anterior já foi validada pelo usuário contra Entra e Graph reais: OBO delegado, `/me`, tenant/principal, ZIP e download único. Esta rodada evolui consentimento combinado, catálogo e hardening `azp`. O aceite do **novo fluxo em tenant sem grants prévios** continua pendente do teste manual. Não confundir a evidência real anterior com os testes sintéticos desta rodada.

## Baseline antes das alterações

- 101 testes aprovados antes das alterações: contracts 6, API 71, Web 24.
- Os caminhos de engine e o ExecutionPanel aprovados foram tomados como baseline de regressão; não foram redesenhados.

## Resultado final

| Verificação | Resultado |
| --- | --- |
| Instalação local (`npm install`) | passed; zero vulnerabilidades reportadas |
| Instalação lockfile no Docker (`npm ci`) | passed; zero vulnerabilidades reportadas |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run test`, Windows | 140 passed; 0 failed |
| `npm run test`, Linux na imagem development sem rede | 140 passed; 0 failed |
| `npm run test:ui`, Edge real headless | 9 passed; 0 failed |
| `npm run build`, local e Docker | passed |
| Build final runtime e development via Compose | passed |
| Compose config / up / health | passed com configuração sintética, sem login |
| HTTP health, catálogo anônimo 401, CORS exato, Web e callback popup | passed |
| `Validate-GraphModule.ps1` no runtime final | passed; Graph sintético em memória |
| `Validate-HelloWorld.ps1` no runtime final | passed; PowerShell real e ZIP em RAM |
| E2E HTTP Hello World | passed; JWT RS256 assinado localmente, validador real e PowerShell real |
| `git diff --check` | passed |

Os 140 testes são 8 de contracts, 80 da API e 52 do Web. Preservam assinatura/issuer/audience/exp/tid/oid/scp, isolamento por usuário/tenant, OBO/claims challenge, cancelamento/deadline, download único/TTL, redaction e armazenamento MSAL. Acrescentam `azp` válido/incorreto/ausente, `.default` separado de `Assessment.Run`, recuperação explícita/falha/cancelamento/admin, orçamento compartilhado CA/consentimento, unmount e troca de conta, metadados centrais, ordenação determinística, filtros e temas.

O teste de armazenamento usa MSAL real com respostas sintéticas: login `.default`, aquisição silenciosa normal, reconsentimento `prompt=consent`, force refresh `Assessment.Run` e nova instância. Verifica zero escritas ao Web Storage e zero abertura de IndexedDB. Não substitui inspeção em um navegador conectado ao Entra.

Os 9 testes de navegador usam fixtures isoladas, sem Graph/Entra real, em 1440, 1100 e 390 px: grid 3/2/1, ausência de overflow horizontal, drawer lateral/timeline/métricas/download único, três temas/cinco áreas, diálogo/foco/Escape, recovery e callback sem scripts. Os cards adicionais existem somente no mock para provar o grid; não foram registrados no produto. Capturas opcionais usaram somente dados sintéticos em diretório ignorado. O harness não entra no bundle de produção.

Contraste calculado do accent principal contra a base `#0c1929`: Azure 9,66:1, AWS 11,26:1 e GCP 8,78:1. Isso verifica essas combinações, não constitui auditoria completa de acessibilidade.

Falhas intermediárias corrigidas: retorno/ciclo de foco no diálogo e injeção HMR/React Refresh pelo Vite no callback de desenvolvimento. O callback é servido como HTML estático antes da transformação; regressão incluída. A rodada final não tem falhas.

Os dois validadores PowerShell rodaram com `--network none`, `--read-only` e `/tmp` em tmpfs. O Hello World verificou contexto stdin, NDJSON stderr, ZIP stdout, conteúdo e ausência de gravações de assessment no workspace e `/tmp`.

O E2E HTTP usou uma chave RSA gerada apenas em memória e o provider de chave do harness de testes. Não houve alteração do servidor de produção, bypass público de autenticação, login Microsoft ou chamada Graph nesse teste. Ele validou o ciclo STARTING → RUNNING → COMPLETED, download e indisponibilidade do segundo download.

## Ambiente e avisos

- Docker Engine 29.7.2; imagem Linux amd64 com Node.js 24.20.0 e PowerShell 7.6.5.
- O frontend compilou com aviso de chunk acima de 500 kB: aproximadamente 651 kB minificado / 183 kB gzip. Não é falha de build.
- O npm avisou sobre dependência transitiva deprecated e política de install scripts; instalação, build e testes passaram.
- Os containers e a rede do projeto temporário `cloudops-validation` foram removidos após os testes; as imagens locais foram mantidas. Nenhum volume de dados foi criado.
- O `.env` existente não foi lido nem alterado nesta rodada; o Compose de validação usou `.env.example` e overrides sintéticos no processo. Nenhum commit, push, PR, merge ou tag foi realizado.

## Aceite real ainda necessário

Siga [Entra setup](entra-setup.md) e [Desenvolvimento local](local-development.md):

1. Preserve os dois App Registrations multitenant organizacionais e confirme `api.knownClientApplications` na API.
2. Mantenha `Assessment.Run` no Web e Graph delegated `User.Read` somente na API. Não conceda grants manualmente antes do aceite.
3. Acrescente `CLOUDOPS_ENTRA_WEB_CLIENT_ID` ao `.env` existente uma única vez e execute `docker compose up --build`.
4. Use tenant de laboratório novo/sem grants conforme [procedimento de revogação limitada](entra-setup.md#9-testar-tenant-novo-ou-revogar-consentimento-antigo); entre com conta organizacional e execute Azure → SecOps → Conectividade e diagnóstico → Microsoft Graph Connectivity.
5. Valide o `/me` real no ZIP, download único, ausência de tokens Graph no browser e ausência de persistência controlada pelo CloudOps.
6. Repita com outro usuário e, se disponível, outro tenant; valide o isolamento e as políticas de consentimento/Conditional Access.

Na etapa histórica da foundation, AWS/GCP não estavam conectados e assessments operacionais, hosting Azure e Inactive Users ainda não estavam implementados. A ferramenta de inativos foi acrescentada posteriormente; veja a validação no início deste documento.

`.default` considera permissões estáticas, portanto novas permissões futuras podem exigir reconsentimento. Se Microsoft exibir necessidade de administrador somente dentro do popup e o usuário fechá-lo, pode voltar apenas `user_cancelled`; CloudOps não inventa um erro administrativo sem sinal explícito. Políticas do tenant e Conditional Access continuam sendo respeitadas.

## Correção posterior — card da sidebar após login

O bloco da conta podia forçar o Flexbox a comprimir o card do provider, cujo `overflow: hidden` cortava o conteúdo. Os filhos diretos da sidebar agora preservam suas alturas naturais (`flex-shrink: 0`), usando a rolagem vertical existente quando falta espaço. O espaçamento do seletor também deixou de afetar o título do bloco da conta. Não houve mudança em autenticação ou ExecutionPanel.

Nove regressões adicionais cobrem Azure/AWS/GCP com bloco de conta maior, janela baixa (1280×560), texto ampliado (1440×700, fonte base 20px) e mobile (390×667). Nos providers sem autenticação, o teste apenas reserva espaço no bloco existente; não simula login. Antes da correção, os seis casos desktop falhavam por corte do card. Depois: **18 testes de navegador aprovados, zero falhas**, incluindo as nove regressões anteriores. Typecheck, lint, build e `git diff --check` também aprovados.
