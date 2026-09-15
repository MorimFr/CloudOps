# CloudOps Assessment SDK v1

A SDK é o motor reutilizável de assessments estruturados. Framework não é engine: nenhum módulo em `engine/shared/assessment-sdk/` importa Microsoft Graph, conhece Entra, CIS ou controles de Identidade. Os contratos estáveis estão em `packages/contracts/src/assessment-sdk.ts`; PowerShell valida os DTOs explicitamente.

```text
Plugin + Control Pack versionado
  → Planner → collectors únicos → normalização incremental
  → evaluators determinísticos → Evidence → Finding → Risk
  → enriquecimento consultivo opcional → ReportModel → ZIP em RAM
```

## Responsabilidades

| Componente | Responsabilidade | Não faz |
| --- | --- | --- |
| Collector | Obter fatos de um provider e reportar qualidade da coleta | Emitir PASS/FAIL |
| Normalizer | Produzir estado estável e mínimo | Preservar respostas completas por conveniência |
| Evaluator | Comparar control + estado + contexto fixo | Autenticação, Graph, rede, arquivos, IA ou relógio global |
| Evidence | Prova estruturada do resultado | Substituir fatos por narrativa |
| Finding | Reunir veredito, aplicabilidade, confiança, evidência e referência de recomendação | Delegar decisão à IA |
| Risk | Calcular prioridade CloudOps determinística | Substituir veredito do framework |
| AI boundary | Produzir narrativa consultiva separada | Alterar resultados autoritativos |
| ReportModel | Apresentar resultados, cobertura e proveniência reconciliados | Receber credencial ou decidir conformidade |

## Contratos e limites

Versão do motor: `cloudops.assessment-sdk.v1`. Control Pack, Definition, Plan, CollectorResult, NormalizedState, ControlResult, Finding, AssessmentResult, AI input/enrichment e ReportModel possuem discriminadores `schemaVersion`; Risk usa `cloudops.risk.v1`. Control, Evidence, Recommendation, Context e Metadata têm schemas próprios e são compostos pelos contratos versionados.

DTOs são estritos: chaves extras, propriedades inesperadas, enums desconhecidos, IDs inválidos, referências ausentes e contagens inconsistentes são rejeitados. Facts v1 são agregados: até 64 chaves aprováveis, valores inteiros seguros, booleanos ou `null`. Não aceitam strings livres, objetos, arrays de usuários nem JSON Graph. Uma futura necessidade de evidência individual mínima exige extensão deliberada/versionada do contrato, não um campo `raw` sem limites.

Há no máximo 1.000 controles por pack, 100 collectors por definição, 32 requisitos por controle e 32 packs por definição. O startup limita a definição a 512 KiB e cada pack a 1 MiB. O núcleo mantém apenas agregados pequenos; não duplica inventários de tenant entre evaluators.

## Registro e planejamento

`assessment.json` continua sendo a declaração do plugin. O arquivo opcional e fixo `assessment-sdk.json` declara versões, capacidades, catálogo de recomendações, metadados dos collectors/evaluators e pins dos packs. Plugins legados sem esse arquivo continuam independentes.

O registry de implementações PowerShell é código revisado: ID → scriptblock conhecido. JSON não escolhe scripts. O startup TypeScript valida os arquivos estáticos e todas as referências sem importar PowerShell, autenticar ou consultar Graph. O preflight PowerShell valida novamente a definição, o contexto, os registros e o pack antes de invocar qualquer collector.

O Planner valida **todo o pack antes de selecionar controles**, inclusive referências em controles não selecionados. Em seguida ordena por `order` e ID ordinal, deduplica collectors e calcula a união ordenada das permissões. Trinta controles que dependem de quatro collectors produzem quatro coletas. O manifest precisa declarar um superset das permissões usadas pelo pack; o pack nunca declara scopes. A validação Azure usa a allowlist Graph existente, fora do core.

MANUAL não agenda coleta. HYBRID faz fallback para MANUAL nesta versão; suas referências continuam sujeitas à validação. Collectors reais registrados mas não usados pelo pack DEV não ampliam consentimento nem são executados.

## Coleta, normalização e capacidades

Collector recebe `CollectorContext` específico do provider e um contexto seguro separado. Somente o primeiro pode conter autenticação. Retorna `collectorId`, `SUCCESS | PARTIAL | FAILED`, `requestCount`, `data` e códigos seguros de warning. Exceção ou saída inválida torna a coleta FAILED, sem propagar corpo HTTP, headers ou token.

Para coleções grandes: página → item → normalização/agregação → descarte. `NormalizedState` contém apenas timestamp, datasets `{status, facts}` e capacidades `AVAILABLE | UNAVAILABLE | UNKNOWN`. O evaluator recebe somente os datasets declarados em seus requisitos, em cópia separada, nunca o token ou o contexto original do provider.

Capacidade/licença indisponível não significa FAIL. O evaluator determina NOT_APPLICABLE quando há evidência de inaplicabilidade; se não puder concluir, UNKNOWN. Uma coleta PARTIAL ou dataset ausente gera UNKNOWN; FAILED gera ERROR antes da avaliação. Campos ausentes não viram zero ou sucesso por conveniência.

## Evaluators determinísticos

Entradas: Control, NormalizedState e AssessmentContext com um único `assessmentTimestamp` UTC fornecido no início. O retorno é ControlResult: status, aplicabilidade, confidence, observed, expected, evidências, reasonCode e flags de risco.

As implementações aprovadas passam por allowlist positiva da AST e executam em runspace vazio, sem comandos/providers, em ConstrainedLanguage. A linguagem admitida usa parâmetros, variáveis locais, literais, indexação, condicionais e aritmética; não admite métodos CLR, imports, comandos, redirecionamento, scopes ambientais ou expressões executáveis vindas do pack. Há orçamento de execução e descarte do runspace.

Esses controles são defesa em profundidade para código revisado, **não um sandbox para módulos PowerShell hostis**. O cancelamento do runspace é cooperativo e não fornece quota de heap por evaluator; código revisado deve evitar alocações desproporcionais. Collectors/plugins são parte do build confiável e precisam de revisão. Restrição de linguagem sozinha não substituiria esse limite de confiança.

Resultados fechados:

- PASS/FAIL: evidência suficiente, aplicabilidade APPLICABLE e evidência estruturada não vazia.
- MANUAL: validação humana; HYBRID não simula avaliação concluída.
- NOT_APPLICABLE: evidência de inaplicabilidade.
- UNKNOWN: dados insuficientes.
- ERROR: falha técnica.

Confidence HIGH/MEDIUM/LOW mede confiabilidade da evidência, não severidade. Proveniência registra a versão do evaluator designado inclusive quando a coleta impede sua execução; o status/reasonCode informa que não houve conclusão.

## Evidence, Finding, Risk e recomendações

Exemplo de Evidence: `{type: "configuration-summary", facts: {enabledPolicies: 4, matchingPolicies: 0}}`. Não é narrativa gerada. Finding combina ID/título/área, status, aplicabilidade, evaluation, risk, observed/expected, evidence, reasonCode e recommendationId.

Ranks de risco: LOW=0, MEDIUM=1, HIGH=2, CRITICAL=3. Fórmula v1:

```text
rank = min(3, baseRank + max(0, exposed + privileged - compensatingControl))
```

As flags são booleanas. Compensação pode reduzir o incremento, nunca a severidade base definida pelo control. O relatório de prioridades conta somente findings FAIL; risco potencial em outros estados não equivale a falha de conformidade.

Recomendações são um catálogo independente e versionado com `recommendationId`, `title`, `summary`, `technicalSteps`, `portalPath`, `impact`, `rollback` e `validation`. IA não inventa o procedimento autoritativo. O ReportModel inclui apenas recomendações referenciadas.

## Cobertura, sem score enganoso

Contagens reconciliam tipos, resultados e aplicabilidade com os findings. `manualControls` conta definições MANUAL; `manualResultControls` conta resultados MANUAL, incluindo HYBRID e eventual necessidade de revisão identificada por evaluator.

| Métrica | Numerador | Denominador |
| --- | --- | --- |
| automationCoverage | Definições AUTOMATED | Todos os controles selecionados |
| evaluatedPassRate | PASS | PASS + FAIL |
| evaluationCoverage | PASS + FAIL | Total menos NOT_APPLICABLE |

Automation coverage é automação **prevista**, não coleta bem-sucedida. Evaluation coverage inclui MANUAL/UNKNOWN/ERROR no denominador enquanto não excluídos por inaplicabilidade. Todas as razões apresentam numerador, denominador e percentual de duas casas; denominador zero produz `null`, nunca 100%. Não há um único compliance score.

## AI boundary

Esta entrega não configura provedor LLM, chave, endpoint, pacote ou chamada externa. Existe interface para adapter futuro, schemas, sanitizer e fake provider puro com prazo limitado nos testes.

Entrada permitida: IDs de controles do pack validado, status/severity fechados e apenas fatos numéricos/booleanos aprovados por `aiFactAllowlist`, com filtro adicional de nomes de identificadores/segredos. Não entram UPN, e-mail, displayName, GUID, tenant, nomes de políticas/grupos/aplicações, headers, tokens, respostas Graph, observed completo, evidence completo ou narrativas livres.

O provider devolve o envelope `cloudops.ai-enrichment.v1`, com status de enriquecimento e `advisory` (ou null se indisponível). Dentro do advisory são permitidos somente `executiveNarrative`, `technicalExplanation`, `riskContext`, `crossFindingCorrelations`, `remediationPriority`, `roadmapSuggestions`. É validado estritamente e mantido em objeto separado. Campo extra de resultado como `status`, `evidence`, `baseSeverity`, `applicability`, definição ou versão dentro do advisory é rejeitado, não mesclado. O status de enriquecimento não é o status do assessment nem do finding. Ausência de provider resulta NOT_REQUESTED; falha, timeout ou saída inválida resulta UNAVAILABLE. O assessment e seus quatro artefatos continuam sendo gerados.

O contrato não garante veracidade de narrativa de um futuro LLM: ela deve permanecer rotulada como consultiva, sujeita à revisão humana. Habilitar serviço externo exige outra decisão arquitetural de privacidade e segurança.

## Integração e reuso

O ponto de entrada genérico é `Invoke-CloudOpsAssessment`, com `ControlPackJson` original, definição, registries estáticos, Context seguro, hash pin, permissões do manifest e CollectorContext separado. O motor reconfere hash/versão e faz parse do texto original antes do planejamento: um DTO mutável carregado anteriormente não pode substituir o conteúdo publicado mantendo sua proveniência antiga. O retorno tem `result` e `reportModel`. O adapter de relatório de Identidade gera o ZIP a partir de ReportModel, sem credenciais.

Outro plugin, por exemplo endpoint, storage ou secure-score, fornece apenas seu manifest/profile, packs, collectors/normalizers, evaluators e recomendações. Reutiliza Planner, Evidence, Finding, Risk, AI boundary, contratos de relatório e validadores. Não copie o core para um novo framework.

O protocolo público existente não mudou: INITIALIZING/AUTHENTICATING/PROCESSING/GENERATING_REPORT/COMPLETED e métricas agregadas já permitidas. O skeleton de Identidade permanece desabilitado até existir um pack real autorizado; seu harness DEV é interno aos testes, sem opção de fixture no HTTP e sem alterar o ExecutionPanel.

Veja [Control Packs](control-packs.md), [Identidade](identity-assessment.md), [Zero Retention](zero-retention.md) e [validação](validation-report.md).
