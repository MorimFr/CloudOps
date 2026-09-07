# Arquitetura multicloud

O catálogo segue uma hierarquia simples:

```text
Cloud Provider
    -> Operational Domain
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

Após autenticação, o frontend consulta `GET /api/v1/assessments` e filtra os metadados do registry por `provider`, `domain` e `visibility`. Os cards não são hardcoded.

Cada entrada declara:

```text
provider
domain
visibility
requiredAuthProvider
requiredPermissions
adminConsentRequired
```

`microsoft-graph-connectivity` fica em `azure/secops` com visibilidade pública. `hello-world` fica em `azure/devops` com visibilidade de desenvolvimento e só aparece quando o Vite está em development e `VITE_SHOW_DEV_ASSESSMENTS=true`.

## Estado atual

Azure usa a integração Microsoft Entra/Graph real. AWS e GCP provam que roteamento, selector e as cinco áreas são provider-agnostic, mas ainda não possuem autenticação nem APIs. Essa ausência é explícita na UI; não existe autenticação simulada.
