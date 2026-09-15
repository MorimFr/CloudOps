# Control Packs

Control Pack é dado estático versionado; não é script, collector nem motor de avaliação. A SDK é reutilizada quando o framework muda.

## Estrutura v1

```json
{
  "schemaVersion": "cloudops.control-pack.v1",
  "id": "example-development-pack",
  "name": "Synthetic development pack",
  "framework": "cloudops-development",
  "frameworkVersion": "1.0",
  "controlPackVersion": "1.0.0",
  "scope": ["example-area"],
  "source": { "kind": "DEVELOPMENT", "reference": "CloudOps original synthetic test content" },
  "controls": [{
    "id": "DEV-EXAMPLE-001",
    "title": "Synthetic manual verification",
    "area": "example-area",
    "order": 10,
    "evaluationType": "MANUAL",
    "collectorRequirements": [],
    "evaluator": null,
    "severity": "LOW",
    "recommendationId": "example-review",
    "parameters": {}
  }]
}
```

Exemplo somente documental; o recommendationId precisa existir no profile do plugin. Os packs executáveis desta entrega estão em `engine/identity-assessment/control-packs/` e são explicitamente sintéticos, não CIS.

Controles têm ID único e estável, área contida em scope, ordem explícita, tipo fechado e apenas referências a registries aprovados. O Planner ordena por `order` e desempata pelo ID ordinal. Reordenar o JSON não muda a ordem do plano, mas muda seu hash de conteúdo: a proveniência aponta para o arquivo exato publicado.

## Profile e pins

`engine/<id>/assessment-sdk.json` usa `cloudops.assessment-definition.v1` e registra assessmentVersion, sdkVersion, capacidades, allowlist AI, collectors, evaluators, recomendações e referências:

```text
controlPacks: [{id, version, file, sha256}]
```

`file` só aceita basename JSON aprovado, sem diretórios. A API lê esse arquivo dentro de `control-packs/`; nunca executa seu conteúdo. PowerShell usa paths estáticos do adapter, não paths fornecidos pelo usuário ou pelo control.

SHA-256 é calculado sobre texto UTF-8, descartando o BOM inicial e normalizando CRLF para LF. Isso mantém os pins entre checkouts Windows/Linux; não é canonicalização de JSON. Outros espaços e alterações semânticas alteram o hash. Pin, ID e versão devem corresponder ao arquivo. A mesma combinação ID+versão com conteúdos diferentes no startup falha.

Após publicação, ID+versão são imutáveis por política de release. Toda mudança em control, parâmetros, dependências ou conteúdo pede nova versão e novo pin revisado. Hash detecta alteração contra o pin aprovado; **não impede que alguém com acesso ao código reescreva intencionalmente arquivo e pin sob a mesma versão**. Revisão de release e histórico do repositório continuam necessários; não foi criado banco ou ledger persistente para esse fim.

`assessmentVersion`, `sdkVersion`, `frameworkVersion`, `controlPackVersion`, hash, versões dos evaluators e timestamp único UTC entram em metadata. Reprodutibilidade exige também preservar o build revisado dos collectors/evaluators, não apenas o nome do framework.

## Validação e segurança

```powershell
npm run assessments:validate
npm run assessments:list
npm run control-packs:validate
npm run control-packs:list
```

Esses comandos não autenticam nem executam PowerShell. Validam schema estrito, versão, duplicatas, áreas/ordem, referências, pins, arquivos limitados e sem links, dependências do evaluator e união de permissões contra o manifest. Erros são sanitizados. Mesmo plugin desabilitado e control não selecionado precisam ser válidos; configuração inválida impede startup/preflight, sem coleta parcial.

Control Pack não aceita PowerShell path, comando shell, URL, Graph endpoint, scope, HTML, JavaScript ou expressão executável. O catálogo de implementação é código confiável; texto em uma definição nunca é avaliado como código. Registries usam IDs conhecidos. Permissões pertencem aos collectors e ao manifest; o adapter Azure ainda exige a allowlist Graph do produto.

O listing exibe apenas metadados de produto: nome, ID, versão, origem, contagens por tipo e número de collectors únicos. Nenhum dado de tenant.

## Implementar um novo controle

1. Obter fonte própria ou explicitamente autorizada/licenciada e registrar a referência; não coletar conteúdo proprietário por scraping.
2. Adicionar definição com ID estável, área, ordem, tipo, severidade e parâmetros estritos.
3. Identificar collector requirements e reutilizar collectors existentes sempre que possível.
4. Se necessário, criar collector/normalizer incremental com campos mínimos e testes de erros/paginação.
5. Criar evaluator puro com contexto temporal injetado e sem IO.
6. Registrar recommendation independente com impacto, rollback e validação.
7. Criar fixtures PASS, FAIL, inaplicabilidade, dados insuficientes e falha técnica; verificar evidência exata e determinismo.
8. Validar deduplicação, permissões, sanitização AI e report offline; nenhuma mudança automática em App Registrations.
9. Incrementar packVersion e versões das implementações alteradas, recalcular pin, executar validadores e revisar o diff.
10. Publicar build revisado e reiniciar/reimplantar sem execuções ativas. Não existe upload/hot-reload de pack.

## Future CIS M365 integration

**CIS M365 control pack will be added from an authorized source.** Não há benchmark CIS real, texto reconstruído ou IDs oficiais inventados nesta entrega. Não foram baixados PDFs nem copiados títulos, rationale, audit procedures ou remediation proprietários.

Fluxo futuro: fonte autorizada/licenciada → pack CIS versionado → mapeamento para collectors/evaluators CloudOps → fixtures e revisão de cobertura/licença → release. A licença e autorização da fonte devem ser conferidas antes de incorporar conteúdo; `source.kind=AUTHORIZED` sozinho não comprova autorização jurídica. Primeiro vem o motor, depois o benchmark; IA permanece consultiva.
