# CloudOps Report Standard v1

`engine/shared/CloudOps.Report.psm1` é o módulo visual reutilizável, independente de Identity: documento offline, header em gradiente azul, eyebrow CloudOps, título responsivo, descrição, metadata pills, cards, gráficos SVG com legendas, tabelas e estilos de impressão. Os assets são HTML/CSS/SVG locais, sem JavaScript, fontes remotas, imagens, tracking ou requests. O relatório Inactive Users não foi reescrito nesta fase; seu vocabulário visual orienta o padrão compartilhado.

Renderers compõem HTML interno conhecido; todo texto de dados passa por HTML encoding. CSV usa quoting e proteção contra fórmulas. Content-Security-Policy fecha scripts, requests e forms. Tabelas podem rolar internamente no mobile; não ampliam o viewport. Impressão mantém evidências, cabeçalhos e cards em layout compacto.

## Projeção Identity

`New-IdentityWave1FindingProjection` produz `controlEvaluated`, `gap`, `gapDescription` e `recommendation`. Gap é um rótulo fixo curto; descrição contextual vem do catálogo e os valores observados, esperados e a evidência **vêm do evaluator**. Recomendação e caminho de portal vêm do RecommendationRegistry, não de IA.

Depois dos cards, a narrativa é DETERMINISTIC ou AI_ENRICHED. As tabelas autoritativas não dependem da narrativa. Gaps FAIL são agrupados em tabelas separadas CRITICAL → HIGH → MEDIUM → LOW, sempre com `Controle Avaliado | Gap | Descrição do Gap | Recomendação`. Categorias zeradas ficam nos cards, sem tabela vazia. PASS aparece compacto/recolhível; MANUAL, UNKNOWN/ERROR e NOT_APPLICABLE têm seções distintas. A cobertura é parcial e explícita.

Header: nome informado da organização, Tenant ID da autenticação, resumo de capacidade/licenciamento não inventariado, benchmark, perfil, timestamp UTC e pack. Proveniência: versão do benchmark, pack/hash e SDK. Não há nomes ou IDs individuais de objetos Graph.

## Artefato

O ZIP é construído em MemoryStream e contém exatamente:

- `report.html`: executivo/técnico, offline e imprimível.
- `findings.csv`: somente gaps FAIL, com ControlId (CIS ID), Title, Area, Status, Severity, Confidence, Gap, GapDescription e RecommendationId.
- `controls.csv`: todos os controles selecionados, inclusive inconclusivos/manuais, com status, observed, expected e reason code.
- `metadata.json`: proveniência, perfil, cobertura, contagens de severidade e modo da narrativa; nenhum token/prompt/resposta bruta.

Quem chama `New-IdentityWave1Archive` deve limpar o buffer e descartar o MemoryStream em finally. A API mantém o ciclo existente de RAM, TTL, cancelamento e download único. Strings gerenciadas não oferecem garantia de zeroização física.

Fixtures e testes: 0 críticos, 4 altos, 2 médios e 1 baixo; colunas exatas, separação de status, HTML encoding, CSV seguro e ZIP sem filesystem. Playwright valida 1440, 768, 390 px e impressão, bloqueando toda rede.
