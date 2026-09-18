# Wave 1 — registro de validação local

**Registro histórico de 2026-09-17.** Em 2026-09-18, o operador solicitou a habilitação para testes; o manifest passou a `enabled=true`, com escolha explícita de perfil na interface. As referências a desabilitação abaixo descrevem a entrega original, não o estado atual. Consulte [estado e instruções atuais](identity-wave1.md).

Validação da habilitação em 2026-09-18: 469 testes unitários (187 contratos, 223 API, 59 web), 20 testes de interface, typecheck, lint, quatro manifests, três packs, builds Docker, E2E HTTP/troca privada de IA e regressão Identity DEV aprovados. O perfil CIS é obrigatório no card e preservado após consentimento. Imagens locais da API/interface reconstruídas para aplicar a mudança; permissões e configuração do tenant não foram alteradas. Nenhum assessment real foi iniciado pelo agente.

Data: 2026-09-17. Somente fixtures sintéticas. Nenhum tenant, Microsoft Graph real ou Foundry real foi acessado pelos testes. Não houve concessão de permissões, provisionamento, implantação, commit ou habilitação pública.

## Baseline e resultado

Baseline unitária antes da implementação: 409 testes aprovados (158 contratos, 197 API, 54 web). Blueprint, dois packs DEV e alterações locais preexistentes foram preservados. Esta entrega acrescenta apenas o pack CIS Wave 1; os outros 61 controles Identity continuam fora do runtime.

| Validação local | Resultado final |
| --- | --- |
| Typecheck e lint | PASS |
| Testes unitários | 464 PASS: 187 contratos, 223 API, 54 web |
| Manifests e control packs | 4 manifests e 3 packs válidos |
| Blueprint CIS | 160 recomendações de origem, 71 incluídas, Wave 1 com 10; 50 testes PASS |
| Graph REST compartilhado | PASS: erros seguros, retry, paginação, host pinning e métricas |
| Hello World PowerShell | PASS: stdin, NDJSON, ZIP em RAM e ausência de escrita de assessment |
| Assessment SDK | 256 checks PASS e 100 execuções determinísticas |
| Identity DEV | 160 assertions PASS, dois packs e 100 execuções determinísticas |
| Identity Users DEV, escala sintética | 200.000 usuários, 201 páginas, 21,0 s; sem retenção de registros individuais |
| Wave 1 evaluators e planner | 202 checks PASS |
| Wave 1 collectors | 132 checks PASS |
| Wave 1 relatório | 36 checks PASS |
| Inactive Users, regressão e escala | PASS; 10.000 usuários sintéticos, 22 requests, 11,9 s |
| E2E HTTP autenticado | PASS: descoberta → HTTP → PowerShell → ZIP RAM → download único |
| E2E privado Identity/backend | PASS: resposta válida, provider ausente, indisponível, resposta inválida e backend que não responde |
| Relatórios em navegador | 12 PASS: desktop, tablet, mobile e impressão; rede bloqueada |
| Interface | 18 PASS, incluindo sidebar autenticada Azure/AWS/GCP |
| Build de produção npm | PASS; aviso preexistente de bundle web acima de 500 kB |
| Imagens development e runtime | PASS; imagem runtime importa API/IA, valida packs/pins e rejeita execução Identity desabilitada, sem rede e com filesystem somente leitura |

Falhas pendentes das suítes acima: **0**. Os tempos de escala são locais, com rede simulada, e não estimam o tempo em um tenant real. O cenário de 200.000 usuários pertence à regressão do collector DEV existente; a Wave 1 consulta configurações e não enumera usuários.

## Verificações específicas

- Dez evaluators independentes, puros e determinísticos; PASS/FAIL/UNKNOWN/ERROR, dados parciais, capability ausente e tipos incorretos. Nenhum NOT_APPLICABLE automático para falta de evidência.
- E3/E5 L1 selecionam sete controles; L2 seleciona dez. Cada família necessária é chamada uma vez pelo planner; paginação/retry permanecem internos ao collector.
- Group.Unified ausente só gera FAIL com coleção comprovadamente completa. Links de paginação com host/rota/versão/filtro/projeção indevidos, loops e truncamento não podem produzir essa conclusão. GUIDs com outra capitalização não alteram o resultado; GUID malformado torna a coleta inconclusiva.
- Fixture de risco calculada pelo engine: 0 CRITICAL / 4 HIGH / 2 MEDIUM / 1 LOW; três PASS. Não representa um ambiente real.
- Tabelas separadas, colunas exatas, evidência observed/expected, encoding, status inconclusivos separados e ZIP com exatamente quatro entradas.
- Input IA reconstruído por allowlist, sem dados identificáveis ou fatos Graph; resposta restrita a quatro campos narrativos. Respostas inválidas/injetadas não alteram os CSVs, comparados byte a byte no subprocesso real.
- Engine com espera real limitada mesmo se o backend mantiver stdin aberto sem resposta; fallback conclui o ZIP. Runtime preserva cancelamento e não publica mensagens privadas como métricas/progresso/SSE.
- Suite PowerShell executada com `--network none`, `--read-only`, engine montado somente leitura e tmpfs. O E2E HTTP usa camada efêmera para compilar contratos; artefatos de assessment continuam exclusivamente em RAM.

## Como repetir

Da raiz: `npm run typecheck`, `npm run lint`, `npm test`, `npm run assessments:validate`, `npm run control-packs:validate`, `npm run cis:validate`, `npm run test:cis`, `npm run build`, `npm run test:ui`.

Construir a imagem development com `docker/runtime.Dockerfile`. Nela, sem rede, executar `npm run test:e2e:local`. A rotina inclui o teste de backend sem resposta, que leva aproximadamente 31 segundos além das outras fixtures.

Para PowerShell: executar `engine/tests/Validate-GraphModule.ps1`, `Validate-HelloWorld.ps1`, `Validate-AssessmentSdk.ps1` e `Validate-InactiveUsers.ps1 -ScaleUsers 10000`; em `engine/identity-assessment/tests/`, executar `Validate-IdentityAssessment.ps1`, `Validate-Wave1.ps1`, `Validate-Wave1Collectors.ps1` e `Validate-Wave1Report.ps1`. Usar as flags de isolamento da CI.

Para relatórios: apontar `CLOUDOPS_TEST_IMAGE` para a imagem local e executar `npm run test:reports`. Fixtures não são selecionáveis pela API e não exigem credenciais.

## Arquivos criados nesta entrega

- `apps/api/src/services/executive-summary-provider.ts`
- `apps/api/test/executive-summary-provider.test.ts`
- `apps/api/test/identity-wave1.e2e.ts`
- `packages/contracts/src/ai-executive-summary.ts`
- `packages/contracts/test/ai-executive-summary.test.ts`
- `engine/shared/CloudOps.Report.psm1`
- `engine/identity-assessment/control-packs/cis-m365-7-0-0/identity-wave1.json`
- `engine/identity-assessment/src/wave1-catalog.json`
- `engine/identity-assessment/src/Wave1Assessment.psm1`
- `engine/identity-assessment/src/ExecutiveSummary.psm1`
- `engine/identity-assessment/src/collectors/Wave1.psm1`
- `engine/identity-assessment/src/evaluators/Wave1.psm1`
- `engine/identity-assessment/src/report/Wave1Report.psm1`
- `engine/identity-assessment/tests/Wave1Fixture.psm1`
- `engine/identity-assessment/tests/Invoke-Wave1ExchangeFixture.ps1`
- `engine/identity-assessment/tests/Validate-Wave1.ps1`
- `engine/identity-assessment/tests/Validate-Wave1Collectors.ps1`
- `engine/identity-assessment/tests/Validate-Wave1Report.ps1`
- `tests/reports/identity-wave1.spec.ts`
- `docs/identity-wave1.md`
- `docs/report-standard-v1.md`
- `docs/foundry-executive-summary.md`
- `docs/identity-wave1-validation.md`

## Arquivos modificados nesta entrega

- `.env.example`
- `.github/workflows/ci.yml` (preservando validação do blueprint preexistente)
- `apps/api/package.json`, `package-lock.json`
- `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/src/auth/obo-service.ts`
- `apps/api/src/services/control-pack-discovery.ts`, `apps/api/src/services/powershell-runtime.ts`
- `apps/api/test/assessment-registry.test.ts`, `apps/api/test/control-packs.test.ts`, `apps/api/test/powershell-runtime.test.ts`
- `packages/contracts/src/assessment.ts`, `packages/contracts/src/assessment-sdk.ts`, `packages/contracts/src/index.ts`
- `packages/contracts/test/contracts.test.ts`, `packages/contracts/test/assessment-sdk.test.ts`
- `engine/shared/assessment-sdk/Evaluation.psm1`, `engine/shared/assessment-sdk/Validation.psm1`
- `engine/identity-assessment/assessment.json`, `engine/identity-assessment/assessment-sdk.json`
- `engine/identity-assessment/Invoke-Assessment.ps1`, `engine/identity-assessment/README.md`
- `engine/identity-assessment/src/IdentityAssessment.psm1`, `engine/identity-assessment/tests/Validate-IdentityAssessment.ps1`
- `docs/zero-retention.md`, `docs/cis/README.md`

`package.json` da raiz, o restante de `docs/cis/` e `scripts/cis/` já tinham alterações locais da fase de blueprint e foram preservados; não são novos artefatos desta Wave 1.

## Gates ainda não executados

Tenant de laboratório, consentimento/papel delegado efetivos, disponibilidade de GroupSettings.Read.All, revisão humana das observações e relatório, licenciamento aplicável e inferência Foundry real com Managed Identity. `store=false` não garante zero retenção operacional no fornecedor. Não há certificação CIS nem avaliação completa do benchmark.

`identity-assessment` permanece **enabled=false**. Próximo passo exclusivo: **Lab tenant acceptance of Wave 1**.
