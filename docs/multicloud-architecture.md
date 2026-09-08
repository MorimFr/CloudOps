# Arquitetura multicloud

O catálogo segue uma hierarquia simples:

```text
Cloud Provider
    -> Operational Domain
        -> Module
            -> Assessment
```

## Providers

O registry de UI centraliza:

```text
azure  Microsoft Azure
aws    Amazon Web Services
gcp    Google Cloud Platform
```

A URL é a fonte de estado; não existe cloud selecionada em storage:

```text
/:provider/:domain
```

Exemplos: `/azure/secops`, `/aws/finops` e `/gcp/devops`.

## Domínios operacionais

Todo provider sempre expõe:

- `dashboard`: visão geral do provider e da conexão;
- `govops`: governança, identidade, compliance e postura;
- `secops`: security posture, identity security, threats e hardening;
- `finops`: custos, otimização, desperdício e governança financeira;
- `devops`: CI/CD, DevSecOps, automação, infraestrutura e práticas de desenvolvimento.

Uma área sem cards continua navegável e mostra um empty state. Não são criados assessments fictícios para preencher o shell.

## Catálogo dinâmico

Após autenticação, o frontend consulta `GET /api/v1/assessments` e filtra os metadados do registry por `provider`, `domain`, `visibility` e `enabled`. Os cards e grupos não são hardcoded.

Cada entrada declara:

```text
provider
domain
moduleId
moduleName
moduleDescription
moduleOrder
assessmentOrder
visibility
requiredAuthProvider
requiredPermissions
adminConsentRequired
```

`microsoft-graph-connectivity` fica em `azure/secops/connectivity-diagnostics` com visibilidade pública. `hello-world` fica em `azure/devops/runtime-validation` com visibilidade de desenvolvimento e só aparece quando o Vite está em development e `VITE_SHOW_DEV_ASSESSMENTS=true`.

## Module registry

`apps/api/src/services/module-registry.ts` centraliza ID, nome, descrição, ordem, provider e domain. Cada assessment registra apenas `moduleId` e `assessmentOrder`. A API resolve/injeta os demais campos públicos; módulo ausente, ID duplicado ou provider/domain incompatível falham na validação. Ordens são inteiros entre 1 e 999.

`AssessmentCatalogSchema` rejeita IDs de assessments duplicados e metadados divergentes para o mesmo módulo. `groupAssessmentsByModule` usa somente a resposta validada, ordenando módulos por `moduleOrder`/ID e cards por `assessmentOrder`/ID. O ID desempata de forma determinística. Módulos sem cards visíveis são omitidos.

Taxonomia atual, **sem registrar funcionalidades futuras**:

```text
Azure
└── SecOps
    ├── 01 Assessments (vazio; oculto)
    │   └── exemplos futuros: identity-assessment, endpoint-assessment
    ├── 02 Visibilidade de segurança de identidade
    │   ├── inactive-users (Mapear Usuários Inativos)
    │   └── exemplo futuro, não registrado: excessive-privileges
    ├── 03 Proteção e resposta (vazio; oculto)
    └── 04 Conectividade e diagnóstico
        └── microsoft-graph-connectivity (implementado)
```

## Temas e densidade

`apps/web/src/config/providers.ts` concentra `primary`, `secondary`, `tertiary`, `quaternary`, `soft`, `border` e `glow`. `providerThemeStyle` aplica variáveis CSS `--provider-*` no workspace e em cada cartão do selector, sem condicionais de cloud espalhadas pelo layout.

- Azure: blue/cyan.
- AWS: amber/laranja/amarelo quente.
- GCP: azul principal, verde secundário e detalhes amarelos/vermelhos discretos.

`catalog.css` delimita os estilos ao catálogo/sidebar/consentimento. Hero compacto, cabeçalho de módulo com contador/linha accent e cards com status textual, descrição, chips de permissão, contexto e ação. Grid: três colunas a partir de 1440px, duas entre 640 e 1439px e uma abaixo de 640px. Uma única ferramenta real ocupa uma coluna; não há cards falsos para preencher as demais.

`ConsentRequiredPanel` é um diálogo nativo com foco contido, Escape e retorno ao acionador. O ExecutionPanel aprovado e seus estilos de progresso permanecem separados e preservados. Não foi criado logo BigBrain nem buscado asset externo.

## Estado atual

Azure usa a integração Microsoft Entra/Graph real. AWS e GCP provam que roteamento, selector e as cinco áreas são provider-agnostic, mas ainda não possuem autenticação nem APIs. Essa ausência é explícita na UI; não existe autenticação simulada.
