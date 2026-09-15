# Assessment de Identidade

O plugin `identity-assessment` é o primeiro consumidor da Assessment SDK. É um **skeleton de desenvolvimento**, não um assessment CIS e não uma avaliação pronta de um tenant. O manifest é público, mas permanece `enabled: false`, com `auth.provider: none` e nenhuma permissão. A descoberta o valida sem habilitar execução; a interface mantém sua regra existente de ocultar assessments desabilitados. O entrypoint também falha de forma fechada se invocado diretamente.

Não houve mudança nas permissões dos App Registrations, no consentimento Microsoft, nos grants, no login ou nos assessments existentes. Não existe parâmetro de API para fornecer um pack, caminho de fixture ou ativar modo sintético.

## Estrutura e fronteiras

```text
identity-assessment/
  assessment.json                 manifest comum, desabilitado
  assessment-sdk.json             registry declarativo e pins dos packs
  Invoke-Assessment.ps1           entrypoint de produção, fail-closed
  control-packs/                  dois packs DEV autorais e versionados
  src/IdentityAssessment.psm1     adaptador do plugin para a SDK
  src/collectors/Users.psm1       adaptador Graph de inventário agregado
  src/normalization/              taxonomia e normalização por item
  src/evaluators/Development.psm1 evaluators determinísticos de exemplo
  src/report/Report.psm1          HTML, CSV e ZIP somente em memória
  tests/                         fixtures locais e validadores offline
```

O módulo do plugin carrega arquivos fixos da implantação. O pack seleciona IDs aprovados; não escolhe código, caminhos de PowerShell, URLs, permissões ou implementações. A escolha de um dos dois packs DEV ocorre somente pelo harness interno de testes. O contexto desse harness deve declarar `dataSource: SYNTHETIC`.

O adaptador entrega o texto JSON original do pack à SDK, que repete o parse, a validação e a comparação do SHA-256 com o pin aprovado imediatamente antes do planejamento. Não recebe um objeto de controle mutável acompanhado de um hash antigo. O callback interno opcional `ProgressCallback` usa somente os estágios já existentes; não amplia métricas públicas nem modifica o drawer.

O registry inclui dois collectors de fixture e um adaptador real de inventário. Os packs DEV **não referenciam o adaptador real**; os testes substituem sua implementação por uma função que falha caso seja chamada. O entrypoint público não chama o harness nem executa esse adaptador.

## Áreas planejadas

| Área CloudOps | Estado normalizado planejado | Situação nesta entrega |
| --- | --- | --- |
| Authentication | `authentication` | Não avaliada |
| Conditional Access | `conditionalAccess` | Não avaliada |
| Privileged Access | `roles`, `authorization` | Não avaliada |
| User Lifecycle | `users` | Exemplo sintético agregado |
| Guest & External Identity | `guests` | Exemplo sintético agregado |
| Applications & Consent | `applications` | Não avaliada |
| Identity Governance | `groups` | Exemplo de validação manual |
| Licensing / Capability Context | `licensing` | Capacidade sintética de inventário |

São oito áreas de apresentação e nove conceitos de estado. Não existem conclusões automáticas para áreas ainda não implementadas. Na v1, a SDK recebe datasets por ID de collector com fatos escalares agregados; os conceitos acima são o plano de evolução do adaptador, não um inventário completo já coletado. Extensões com outros tipos de dado exigem revisão e versionamento do contrato.

## Packs de desenvolvimento

`cloudops-identity-dev@1.0.0` contém dois controles AUTOMATED e um MANUAL. Na fixture-base, os resultados são PASS, FAIL e MANUAL: há três membros, nenhum membro desabilitado, dois convidados e um convite pendente. O controle de convites demonstra risco determinístico MEDIUM → HIGH por exposição. Isso **não** define uma política de remoção de convidados ou de habilitação de contas.

`cloudops-identity-alternate-dev@1.0.0` usa os mesmos collectors, evaluators, recomendações e motor, mas outro framework de desenvolvimento, IDs e parâmetros. Na mesma fixture, os resultados são PASS, PASS e MANUAL. Essa troca demonstra reutilização sem duplicação de engine.

O planner deduplica o collector compartilhado de usuários: cada collector necessário é executado uma vez. Todos os IDs do pack completo são validados antes da coleta, inclusive quando apenas um subconjunto de controles é selecionado. Ambos os packs usam conteúdo autoral sintético, não numeração, texto ou recomendações de benchmarks proprietários.

## Collector de usuários preparado, mas não ativado

`Invoke-IdentityUsersCollector` reutiliza `Get-CloudOpsGraphCollection` do módulo compartilhado. A projeção fixa solicita apenas `userType`, `accountEnabled` e `externalUserState`, sem buscar UPN, nome ou ID para o estado normalizado. Caso o Graph devolva campos extras, eles são ignorados.

Essa consulta não seleciona `signInActivity`, portanto solicita `$top=999`. A documentação distingue o máximo geral de 999 do máximo de 500 quando `signInActivity` é selecionado ou filtrado. Isso não altera a paginação do assessment de Usuários Inativos. [Microsoft Graph: List users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0#optional-query-parameters).

O adaptador percorre sequencialmente o `@odata.nextLink` validado pelo cliente compartilhado. Normaliza cada item imediatamente e mantém nove contadores: total, membros, convidados, membros habilitados/desabilitados, convites pendentes/aceitos, propriedades ausentes e valores inesperados. Não usa consulta por usuário, lista acumulada de todo o tenant, Microsoft Graph SDK ou outro cliente HTTP.

`requestCount` conta páginas concluídas, não tentativas de transporte. Há no máximo 1.000 páginas por padrão, tentativas limitadas e respeito ao Retry-After dentro do orçamento do cliente compartilhado. Uma espera superior ao orçamento não é reduzida: a coleta termina como incompleta. A página corrente e os contadores ficam em RAM; não há cache de inventário.

Valores ausentes, `null` ou enums inesperados produzem PARTIAL. Falha antes de qualquer item produz FAILED; falha depois de itens produz PARTIAL, preservando somente os agregados já observados. Nenhum erro inclui resposta bruta, token ou URI no DTO. A SDK converte coleta incompleta em UNKNOWN e falha em ERROR, nunca em FAIL. Uma coleção vazia válida é SUCCESS com zero itens.

O adaptador registra `User.Read.All`, já existente nos contratos do projeto, mas não a solicita nem altera o manifest DEV. Sua ativação futura requer pack autorizado, escopo revisado e manifest compatível. Não houve teste em tenant real nesta etapa.

## Evidências, resultados e relatório

Os evaluators recebem apenas controle, estado normalizado mínimo e contexto seguro com timestamp fixo. Não recebem token, cliente Graph ou contexto do collector. Produzem fatos observados/esperados, evidências estruturadas, confiança e sinais determinísticos de risco. Ausência de dados necessários não vira PASS; licença/capacidade indisponível não vira FAIL.

O relatório usa exclusivamente o ReportModel validado. Inclui resumo executivo, distribuição de resultados em SVG, cobertura com denominadores explícitos, oito áreas, achados críticos, tabela completa, validação manual, recomendações, metodologia, limitações, evidências técnicas e proveniência. AI Advisory é uma seção separada; provider ausente ou com erro não impede o relatório.

Cobertura de automação mede definições AUTOMATED / total; taxa de PASS mede PASS / (PASS + FAIL); cobertura de avaliação mede (PASS + FAIL) / controles não excluídos por NOT_APPLICABLE. MANUAL, UNKNOWN e ERROR não são considerados reprovações nem conformidade. O gráfico usa a quantidade de resultados MANUAL, não a soma dos tipos de definição.

`New-IdentityAssessmentArchive` devolve um `MemoryStream` contendo exatamente:

| Arquivo | Conteúdo |
| --- | --- |
| `report.html` | Relatório autossuficiente, CSS/SVG inline, sem scripts ou recursos externos |
| `findings.csv` | ControlId, Area, Status, Severity, Confidence, Title, RecommendationId |
| `controls.csv` | ControlId, Area, EvaluationType, Status |
| `metadata.json` | Versões, hash do pack, timestamp UTC e origem SYNTHETIC |

Ambos os CSVs incluem todos os controles selecionados, não apenas FAIL. A renderização aplica HTML encoding e neutraliza fórmulas em células CSV. O contrato também rejeita texto com HTML. Não há gravação de artefatos no servidor. O chamador deve liberar o stream e limpar o buffer após entregar o download; o validador demonstra esse encerramento. Limpeza de referências/buffers gerenciados é best effort, não garantia de apagamento físico imediato de strings pelo runtime.

## Validação offline

Execute `engine/identity-assessment/tests/Validate-IdentityAssessment.ps1` em PowerShell 7.2+ no contêiner de validação, com rede desabilitada, filesystem somente leitura e `/tmp` em tmpfs. O script compara os hashes dos arquivos do engine antes/depois e cria os artefatos apenas em memória.

São verificados os dois packs, deduplicação, PASS/FAIL/MANUAL/NOT_APPLICABLE/UNKNOWN/ERROR, fatos ausentes, 100 execuções determinísticas da mesma fixture, proveniência, colunas CSV, injeção HTML/CSV, ZIP com quatro arquivos e rejeição de contexto LIVE. Providers fake, definidos somente no módulo de testes, exercitam a geração completa do ZIP tanto com AI disponível quanto indisponível: HTML reflete o estado consultivo, enquanto metadata, CSVs e resultado autoritativo permanecem intactos. `Validate-UsersCollector.ps1` usa um HttpMessageHandler fake para 200, paginação, 429/Retry-After, 500, 401/403, falhas de transporte, respostas incompletas, host pinning e 200.000 usuários em 201 páginas com agregado de tamanho fixo.

`-EmitPreview` devolve somente JSON sintético via stdout para Playwright; não grava relatório nem usa dados de tenant. Os testes de relatório fazem parse cruzado dos DTOs PowerShell com Zod e verificam 1440, 768 e 390 px, impressão, gráfico acessível e ausência de requisições externas. Screenshots sintéticos são opt-in via `CLOUDOPS_UI_SCREENSHOTS=true`.

O próximo passo é especificar e aprovar o primeiro pack real de Identidade, com fonte autorizada, direitos de uso, requisitos de evidência e permissões mínimas. Não habilitar este skeleton como assessment de produção nem interpretar controles DEV como requisitos CIS.
