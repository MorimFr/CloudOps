# Validação — Assessment SDK e histórico da foundation

## Assessment SDK — resultado final — 2026-09-15

Implementação local concluída: SDK genérica, DTOs versionados estritos TypeScript/PowerShell, planner com preflight completo, collectors deduplicados, evidências estruturadas, risco determinístico, AI boundary e dois packs DEV reutilizando o skeleton de Identidade. Nenhum conteúdo CIS real ou LLM externo foi incorporado. `identity-assessment` está registrado, público na metadata, mas **desabilitado** e sem auth/scopes; não é uma ferramenta de produção ativada.

### Validações executadas

| Verificação | Resultado final |
| --- | --- |
| `npm install` | Aprovado; 349 pacotes auditados, zero vulnerabilidades reportadas, nenhuma alteração efetiva no lockfile. |
| `npm run typecheck` / `npm run lint` | Aprovados; zero erros e zero warnings de lint. |
| `npm run test` | **409 aprovados, 0 falhas**: contracts 158, API 197, Web 54. Baseline: 232. |
| `npm run build` | Aprovado no host e no build Docker. |
| `npm run assessments:validate` / `assessments:list` | Quatro manifests válidos; Identidade explicitamente disabled. |
| `npm run control-packs:validate` / `control-packs:list` | Dois packs válidos, cada um com três controles, dois AUTOMATED, um MANUAL e dois collectors únicos. |
| CLI compilado da imagem runtime | Quatro manifests e dois packs válidos, sem importar/executar PowerShell. |
| `npm run test:ui` | **18 aprovados**; catálogo, consentimento, drawer e sidebar multicloud preservados. |
| `npm run test:reports` | **8 aprovados**: quatro de Identidade e quatro de Inativos, incluindo 1440/768/390 px e impressão, sem requests externos. |
| `Validate-AssessmentSdk.ps1` | **256 checagens aprovadas**, incluindo 100 repetições determinísticas, hash, preflight, permissões, isolamento, risco e AI adversarial. |
| `Validate-IdentityAssessment.ps1` | **160 assertions aprovadas**, dois frameworks DEV, resultados exatos por evaluator, 100 execuções determinísticas, ZIP com/sem AI fake e cleanup. |
| `Validate-UsersCollector.ps1` (incluído em Identidade) | Matriz Graph fake e **200.000 usuários / 201 páginas / nove agregados**, sem acumular registros individuais. |
| Graph / Hello World / Inativos PowerShell | Aprovados em containers sem rede, read-only; Inativos usa 10.000 contas sintéticas. |
| `npm run test:e2e:local` | Aprovado na imagem development: JWT sintético → HTTP autenticado → discovery → PowerShell real → ZIP RAM → download único. |
| Compose `build` / `up -d --wait` | Aprovados com overlay e projeto isolado `cloudops-sdk-validation`, portas loopback 3011/5181, configuração sintética e `--env-file .env.example`. |
| Serviços da imagem | Runtime healthy, health HTTP 200, catálogo anônimo HTTP 401, Web HTTP 200; filesystem runtime read-only, usuário node, Node 24.20.0, PowerShell 7.6.5. |
| Diff dos componentes preservados | Sem alterações em Inativos, Graph Connectivity, Hello World, Graph/Execution/Security compartilhados ou código frontend. |

O collector de Identidade processou 200 mil objetos em 16,9 s na última rodada, com transporte e esperas simulados. Rodadas concorrentes variaram de 16,8 a 21,0 s; não é benchmark ou SLA do Graph. A estratégia mantém somente a página corrente e os agregados necessários. Os testes usam dados sintéticos, nunca credenciais ou tenant real.

Regressão final de Inativos na imagem: 10.000 contas, 22 consultas, ZIP de 63.283 bytes, 9,8 s e pico de working set 303,3 MiB, também com rede/pacing simulados.

Os validadores novos executaram com engine atual montado read-only e rede desabilitada. Graph/Hello e o E2E também foram confirmados na imagem construída. A última adição de testes exatos por evaluator foi validada pelo mount do código atual; não altera código de produção. O relatório recebeu ainda uma inspeção visual opt-in com fixture sintética; a rodada final voltou ao modo padrão sem capturas.

As primeiras execuções identificaram falhas de implementação que foram corrigidas antes desta aprovação: shadowing de `Count`/`Keys` por fatos em dictionaries PowerShell, perda de distinção ordinal em clones, conversão automática de strings ISO em datas, preservação de `null` em arrays JSON, tipo numérico JSON integral, parâmetro `ProgressAction` conflitante com PowerShell 7.6, saída de runspace e validação do hash do texto efetivamente executado. Os testes agora cobrem essas regressões. Uma checagem HTTP de diagnóstico teve erro de aspas do Windows e foi repetida com sucesso; não foi falha da aplicação.

Avisos não bloqueantes: o bundle frontend continua acima de 500 kB (667,06 kB nesta rodada); npm solicita revisão explícita do postinstall `esbuild`, que não foi aprovado adicionalmente; a imagem development informa depreciação de dependência transitiva `whatwg-encoding`. Instalação, build e testes passaram sem mudar versões ou relaxar controles.

### Revisão explícita de segurança

| Pergunta | Resposta |
| --- | --- |
| Can AI change PASS/FAIL? | Não. Resultado autoritativo separado; advisory estrito, sem merge de campos. |
| Can evaluator call Graph? | Não. AST positiva e runspace vazio/constrained, sem comandos, providers, credenciais ou APIs de IO expostas. |
| Can control pack execute PowerShell? | Não. JSON estrito referencia somente IDs de implementações estáticas revisadas. |
| Can raw Graph response be persisted? | Não pelo pipeline implementado. Página normalizada e descartada, sem arquivos/cache/checkpoint de assessment. |
| Can Graph token reach AI? | Não. Sanitizer recebe apenas resultado agregado; auth pertence ao collector. |
| Can Graph token reach frontend? | Não. Fronteira OBO/stdin existente e projeção pública preservadas. |
| Can control pack request arbitrary Graph scopes? | Não. Scopes não são campos do pack; união dos collectors precisa caber no manifest e allowlist Azure existente. |

Essas garantias descrevem a superfície implementada, não um sandbox para código PowerShell hostil. Módulos do build continuam confiáveis e revisados. Runspace usa cancelamento cooperativo, não quota de heap por evaluator. Wipe de memória gerenciada é best-effort. A imutabilidade de releases depende de revisão/versionamento: hash impede executar conteúdo diferente do pin aprovado, mas não impede alguém com autoridade sobre o repositório de alterar simultaneamente conteúdo e pin.

### Zero Retention e escopo preservado

Não foram adicionados banco, storage, Redis, fila, cache de filesystem, history, checkpoint ou provedor LLM. Artefatos, dados e contexto transitório permanecem em RAM; profiles/packs/recomendações são configuração estática de produto. O arquivo baixado pelo administrador continua sendo a persistência intencional do resultado. Nenhum App Registration, grant, secret ou `.env` foi consultado/alterado por esta entrega. Nenhuma operação de commit, push, PR, merge ou tag foi realizada.

Após os checks, foram removidos somente os containers `cloudops-sdk-validation-cloudops-runtime-1`, `cloudops-sdk-validation-cloudops-web-1` e a rede `cloudops-sdk-validation_default`. São recursos descartáveis recriáveis com o overlay de validação. As imagens `cloudops-plugin-runtime:validation` e `cloudops-plugin-development:validation` foram preservadas; imagens e serviços normais não foram substituídos. `git diff --check` passou no fechamento.

CI acrescenta validate/list de packs e os dois validadores SDK/Identidade; preserva testes de manifests, unitários, UI, Graph, Hello, Inativos, E2E local e relatórios. Os testes de Identidade incluem fake collector 200/429/500/401/403, paginação, Retry-After, campos ausentes/null/enums, partial, falha de rede, limite de páginas e host pinning. O SDK testa alteração de status/evidence/severity/applicability/versões pela IA, timeout/erro, hashes modificados e referências inválidas antes de coleta. Playwright valida DTOs PowerShell com os schemas Zod.

### Inventário de arquivos desta entrega

Criados:

- `packages/contracts/src/assessment-sdk.ts` e `packages/contracts/test/assessment-sdk.test.ts`.
- `apps/api/src/services/control-pack-discovery.ts`, `control-pack-validation.ts`, `apps/api/src/cli/control-packs.ts` e `apps/api/test/control-packs.test.ts`.
- `engine/shared/assessment-sdk/`: `CloudOps.Assessment.psm1`, `Validation.psm1`, `ControlPack.psm1`, `Planner.psm1`, `Collector.psm1`, `Normalization.psm1`, `Evaluation.psm1`, `Evidence.psm1`, `Finding.psm1`, `Risk.psm1`, `AiBoundary.psm1`, `ReportModel.psm1`.
- `engine/tests/Validate-AssessmentSdk.ps1`.
- `engine/identity-assessment/`: `assessment.json`, `assessment-sdk.json`, `Invoke-Assessment.ps1`, `README.md`; `control-packs/README.md`, `cloudops-identity-dev.json`, `cloudops-identity-alternate-dev.json`; `src/IdentityAssessment.psm1`, `src/collectors/Users.psm1`, `src/evaluators/Development.psm1`, `src/normalization/IdentityState.psm1`, `src/report/Report.psm1`; `tests/DevelopmentFixture.psm1`, `tests/Validate-IdentityAssessment.ps1`, `tests/Validate-UsersCollector.ps1`.
- `tests/reports/identity-assessment.spec.ts`.
- `docs/assessment-sdk.md`, `docs/control-packs.md`, `docs/identity-assessment.md`.

Modificados:

- `package.json`, `apps/api/package.json`, `packages/contracts/src/index.ts`, `.github/workflows/ci.yml`.
- `apps/api/src/cli/assessments.ts`, `apps/api/src/server.ts`, `apps/api/src/services/assessment-registry.ts`.
- `apps/api/test/assessment-discovery.test.ts`, `assessment-registry.test.ts`, `module-registry.test.ts`.
- `README.md`, `docs/architecture.md`, `docs/assessment-development.md`, `docs/zero-retention.md`, `docs/validation-report.md`.

Limites conhecidos: Identidade desabilitado e sintético; sem CIS real/LLM real; HYBRID é MANUAL na v1; Facts são agregados escalares; sem checkpoint; ativar um primeiro pack real exige fonte autorizada, evidência/coletores adequados e revisão de permissões. Próximo passo recomendado somente: implementar o primeiro Control Pack real autorizado para Assessment de Identidade.

## Assessment SDK — baseline — 2026-09-09

Antes de modificar arquivos, foram revisados README, toda a documentação, contratos, manifests/discovery, engine compartilhado, assessments existentes e testes. A fundação de manifests está completa e o worktree estava limpo.

Baseline executado: **232 testes unitários aprovados** (contracts 36, API 142, Web 54), **18 testes de UI**, **4 testes HTML/print**, typecheck, lint, build, três manifests válidos/listados, validadores PowerShell Graph/Hello World/Inativos e E2E HTTP Hello World aprovados. Inativos com 10.000 contas sintéticas: 22 requisições, ZIP de 63.283 bytes, 10,6 s e pico de working set 315,3 MiB, com rede/pacing simulados.

Host Node 24.19.0/npm 11.17.0; container Node 24.20.0/PowerShell 7.6.5; Compose 5.4.0. Docker Desktop estava desligado e foi iniciado oculto. Testes usaram engine atual montado read-only, containers descartáveis sem rede externa e identidade sintética para HTTP. Nenhum `.env`, credencial, grant, configuração ou imagem normal foi alterado. O aviso preexistente de bundle frontend >500 kB permanece.

## Plugins autodescritivos — baseline e escopo — 2026-09-08

Antes das alterações foram lidos README, toda a documentação, contratos, registries, engine compartilhado, os três assessments, catálogo/UI e testes. O worktree estava limpo. Baseline executado: **146 testes unitários** (contracts 8, API 85, Web 53), **18 testes UI**, **4 testes HTML/print** e validadores PowerShell Graph/Hello World/Inativos aprovados. No Windows, a primeira rodada de UI passou mas seu teardown ficou preso no sandbox; Docker e o validador CLI também exigiram execução fora do sandbox. As rodadas finais usam as permissões adequadas, sem relaxar o produto.

Esta entrega substitui exclusivamente a lista de registrations por manifests versionados e discovery no startup, acrescentando display opcional e testes/documentação. Os scripts/módulos de Inativos, relatório/classificação, Graph Connectivity `/me`, Hello World, módulos compartilhados, ExecutionPanel, autenticação, OBO, ownership e ciclo de artefatos não foram modificados.

### Revisão de segurança dos manifests

| Pergunta | Resultado |
| --- | --- |
| Um manifest pode escapar do engine root? | Não: paths relativos portáveis, contenção realpath e rejeição de links/traversal/arquivos não regulares. |
| O manifest pode executar shell arbitrário? | Não: é JSON estrito, discovery não executa código e o runtime continua `shell:false`. O PowerShell do deployment é código confiável revisado, não sandbox de terceiros. |
| O frontend pode escolher entrypoint? | Não: envia somente assessmentId; path fica no registry interno. |
| Metadata pode injetar HTML? | Não: display recusa markup; ícones são allowlist de SVGs locais e textos são escapados pelo React. |
| Pode adicionar Graph scope arbitrário? | Não: somente o enum existente de quatro permissões; grants/OBO continuam exigidos. |
| Pode expor filesystem pelo catálogo/erro? | Não: projeção pública explícita; erros contêm apenas diretório relativo seguro, campo conhecido e motivo fixo. |
| Manifest inválido pode ser ignorado? | Não: qualquer manifest presente e inválido impede startup, inclusive em ferramenta desabilitada. |

Plugins são configuração/código do build confiável. Não há upload, watcher, instalação runtime, database ou alteração de App Registrations. Manter o deployment imutável é obrigatório; validar metadata não substitui revisão do script. Leitura de configuração estática não altera Zero Retention.

### Resultado final da migração

| Verificação | Resultado |
| --- | --- |
| `npm install` | Aprovado, dependências já atualizadas, zero vulnerabilidades; nenhuma alteração efetiva no lockfile. |
| `npm run typecheck` | Aprovado. |
| `npm run lint` | Aprovado, zero warnings de lint. |
| `npm run test` | **232 aprovados, 0 falhas**: contracts 36, API 142, Web 54. Repetido em Windows e Linux/container. |
| `npm run build` | Aprovado no host e na imagem; aviso preexistente de chunk frontend >500 kB permanece. |
| `npm run assessments:validate` | **3 assessment manifests valid**. Também aprovado no CLI compilado da imagem runtime. |
| `npm run assessments:list` | Somente IDs/provider/domain/module/runtime/visibility dos três assessments; nenhum path absoluto, secret ou token. |
| `npm run test:ui` | **18 aprovados**, incluindo ícone/tags/source dinâmicos em 1440/1100/390 px e regressões do drawer/consent/sidebar. |
| `npm run test:reports` | **4 aprovados**, HTML offline em 1440/768/390 px e impressão. |
| Compose `build` e `up -d --wait` | Aprovados com projeto/overlay isolados e IDs/secret sintéticos, sem usar `.env`. |
| Runtime real da imagem | Node 24.20.0, PowerShell 7.6.5, UID 1000, filesystem read-only, health 200, catálogo anônimo 401. Web 200. |
| Validadores PowerShell Graph/Hello World/Inativos | Todos aprovados em containers read-only, sem rede e com dados sintéticos. |
| `npm run test:e2e:local` | Aprovado: JWT sintético local → HTTP autenticado → discovery real → PowerShell real → ZIP em RAM → download-once. Sem rede externa. |
| Template e diff | JSON documental validado pelo schema e entrypoint documental validado pelo parser PowerShell sem execução; `git diff --check` aprovado; nenhuma mudança de lógica em `.ps1`/`.psm1`. |

O teste de aceitação adiciona uma pasta temporária, inicia a API, consulta catálogo autenticado, executa o ID e confere o path/contexto entregues ao runtime. Depois remove manifest/pasta e reinicia: catálogo vazio e POST 404. Não há watcher. A fixture do script contém `throw`, confirmando que discovery nunca a executa. Testes de paths cobrem Windows/Linux, symlinks de arquivo/pasta/manifest, junctions quando aplicável e hard links; 100 manifests pequenos são descobertos sem editar registry. Os três manifests reais preservam nomes, descrições, módulos, permissões, timeouts e concorrência anteriores.

Inativos nesta rodada: **10.000 contas sintéticas, 20 páginas e 22 consultas**, ZIP de 63.283 bytes, processamento 11,5 s, pico de working set 311,4 MiB. Rede/pacing simulados; não é benchmark do Graph real. O teste anterior de 200.000 contas permanece registrado abaixo; não foi necessário alterar ou repetir a lógica para esta migração.

Avisos não bloqueantes: chunk frontend >500 kB e npm solicitando revisão explícita do postinstall de `esbuild`; não foi concedida aprovação adicional a scripts de dependências. O build e os testes funcionaram. Uma inspeção Docker inicialmente tentou ler health do Web, que não possui healthcheck próprio; a verificação foi corrigida para estado do container e resposta HTTP. O runtime possui healthcheck e ficou healthy.

Após as verificações, foram removidos somente os dois containers e a rede do projeto `cloudops-plugin-validation`, recriáveis pelos comandos documentados. As imagens `cloudops-plugin-runtime:validation` e `cloudops-plugin-development:validation` permanecem locais; imagens/serviços do projeto normal não foram substituídos. O harness de JWT sintético está ausente da imagem runtime. Não houve leitura de tenant real, alteração de grants/App Registrations, `.env`, commit, push ou PR. Para carregar a migração no ambiente normal, reconstruir/recriar em janela sem execução ativa.

Na conferência de fechamento apareceu uma alteração externa de whitespace: um espaço antes de `Set-StrictMode` na primeira linha de `engine/inactive-users/CloudOps.InactiveUsers.psm1`. Foi preservada e não pertence à migração. O diff ignorando whitespace permanece vazio para o módulo; as imagens/testes PowerShell foram construídos antes dessa edição, sem diferença funcional.

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
