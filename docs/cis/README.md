# CIS Microsoft 365 Foundations 7.0.0 — engineering blueprint

Fase de inventário e planejamento, **não um Control Pack executável**. Identity permanece desabilitado. Nenhum Graph real é consultado por estes arquivos ou pelos validadores de desenvolvimento.

Evolução posterior: a [implementação da Wave 1](../identity-wave1.md) usa este blueprint sem alterar os outros 61 controles. Os documentos abaixo preservam as decisões da fase de planejamento; o pack executável vive em `engine/`, não neste diretório.

A fonte privada é o PDF local fornecido pelo desenvolvedor; não foi copiado nem incorporado ao repositório. O índice contém somente identificação estruturada, perfis e referências de páginas — não rationale, impact, audit ou remediation. O hash corresponde aos bytes originais, sem normalização. Páginas são as impressas no benchmark; no visualizador PDF, somar 1 devido à capa.

O CIS define o requisito. Documentação oficial Microsoft define APIs, permissões e semântica dos campos. Diferenças devem permanecer explícitas, nunca reinterpretadas silenciosamente como um requisito novo.

## Reprodução da extração

`scripts/cis/read-benchmark.py` exige Python com `pypdf` instalado separadamente em ambiente de desenvolvimento. Recebe o caminho do PDF como argumento, verifica versão/data e imprime metadados JSON na saída padrão. Não baixa, copia, modifica ou grava o benchmark/texto extraído. A opção `--pages 21:23` permite inspeção local de páginas impressas específicas. Não redirecionar texto integral do benchmark para arquivos versionados.

A análise local não comprova autorização para distribuição comercial do conteúdo: revisar os termos da fonte antes de publicar o futuro pack ou esta documentação. Não há declaração de certificação CIS.

## Baseline desta fase — 2026-09-16

Antes das alterações: typecheck, lint, 409 testes unitários, build, quatro manifests e dois packs DEV aprovados. PowerShell: Graph, Hello World, SDK (256 checks), Identidade (160 assertions, 100 execuções determinísticas, Users com 200.000 objetos/201 páginas) e Inativos (10.000 objetos/22 consultas) aprovados, usando transporte sintético em containers sem rede e com o engine atual montado read-only em `/workspace/engine`.

A primeira tentativa PowerShell teve erro de quoting; outra rodada usou o diretório de mount incorreto e foi descartada como baseline do código atual. Ambas foram corrigidas e todos os validadores repetidos com sucesso. Aviso preexistente de bundle frontend acima de 500 kB permanece. Docker Desktop foi iniciado em segundo plano; nenhum serviço da aplicação foi substituído.

## Entrega e leitura

O índice foi extraído e conferido: 160 recomendações no benchmark, 63 na Section 5. O blueprint inclui 71 controles (63 primários + 8 transversais), 24 famílias de collectors propostas e waves de 10/13/48 controles. As outras recomendações têm decisão explícita de EXCLUDE ou REVIEW. Documento tecnicamente validado não significa aprovação humana para implementar ou conceder permissões.

- [Inventory estruturada](cis-m365-7.0.0-identity-inventory.json): estado esperado, specs de avaliação/evidência, endpoints, permissões, capabilities e questões por controle.
- [Implementation matrix](cis-m365-7.0.0-identity-implementation-matrix.md): visão humana, escopo completo e arquitetura.
- [Collectors](cis-m365-7.0.0-identity-collectors.md): projeções, endpoints e budgets para 1k/10k/50k/200k.
- [Permissions](cis-m365-7.0.0-identity-permissions.md): current, Wave 1, full stable e optional/preview, com diferenças do audit CIS.
- [Wave plan](cis-m365-7.0.0-identity-wave-plan.md): priorização, golden fixtures e gates de aceitação futuros.
- [Open questions](cis-m365-7.0.0-identity-open-questions.md): discrepâncias e limites técnicos/humanos reais.
- [Provenance](cis-m365-7.0.0-identity-provenance.json) e [source index](cis-m365-7.0.0-identity-source-index.json): origem e metadata literal, sem caminho privado absoluto.

## Validação de desenvolvimento

`npm run cis:validate` verifica integridade/referências e reutiliza os contratos primitivos do SDK (status, capability, IDs, versões, timestamp e hash). Não usa ControlPackSchema: estes arquivos deliberadamente não são um pack. `npm run test:cis` testa aceitação/rejeição e determinismo. Ambos compilam somente o workspace contracts antes de carregar seus exports; não executam Graph ou o assessment.

Opcionalmente, `npm run cis:validate -- --source CAMINHO_DO_PDF_ORIGINAL` também confere os bytes contra SHA-256. Nenhuma cópia é criada. CI usa o índice versionado e não exige o PDF privado. Comparar com o índice detecta alterações acidentais, não substitui revisão da fonte; mudanças simultâneas no índice/mapping exigem conferência do original e revisão humana.

O helper Python serve para conferir a extração, não é dependência da aplicação. O material privado permaneceu fora do repositório; não houve necessidade de mudar .gitignore. Dados estruturados esperados são descritivos: o validador não os avalia nem executa URIs/condições. O runtime não importa docs/cis.

## Validação após as alterações — 2026-09-16

| Verificação | Resultado |
| --- | --- |
| Typecheck e lint | PASS |
| Testes existentes | 409 PASS (contracts 158, API 197, web 54) |
| Build | PASS; aviso preexistente de bundle de 667,06 kB permanece |
| Assessment manifests / Control Packs | 4 / 2 válidos; nenhum pack CIS criado |
| Blueprint + SHA-256 do PDF original | PASS; 160 recomendações triadas, 71 incluídas, 24 famílias propostas |
| Testes do validador CIS | 50 PASS; sem Graph/PDF privado obrigatório |
| Graph REST / Hello World PowerShell | PASS |
| Assessment SDK PowerShell | 256 checks; 100 execuções determinísticas; PASS |
| Identity PowerShell | 160 assertions; 100 execuções determinísticas; PASS |
| Identity Users sintético | 200.000 usuários / 201 páginas / 16,6 s; PASS |
| Inativos sintético | 10.000 usuários / 22 requests / 11,0 s; PASS |

PowerShell executado novamente sem rede, engine atual montado read-only. Tempos são de transporte sintético local, não estimativa de Graph real. Nenhuma falha restante nos checks executados. A primeira execução do novo validador identificou diferença entre `v1.0` e o parâmetro documental `graph-rest-1.0`; a comparação foi corrigida e todos os testes repetidos.

Os 50 testes também conferem integridade da matriz/links, recusa de metadata alterada, dependências, perfil herdado, custo de permissão e limites da automação. A CI ganhou somente um passo offline para esses documentos. Nesta fase não foram repetidas as suítes opcionais Playwright UI/reports; nenhum frontend/report/runtime foi modificado.

Runtime inalterado: Identity disabled, auth none, permissions []; sem mudanças no Entra, sem grants novos, sem collectors/evaluators CIS de produção, sem AI e sem execução Graph real. Alterações locais apenas, sem commit/push/PR/merge/tag. Próximo passo recomendado após revisão humana: Implement Wave 1.
