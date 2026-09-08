# Desenvolvimento de assessments

## Estrutura

```text
engine/<assessment-id>/
|-- Invoke-Assessment.ps1
|-- README.md
|-- knowledge/
`-- tests/
```

Um diretório só pode ser executado após entrada explícita no Assessment Registry. Nunca derive path ou comando do cliente.

## Metadata obrigatória

Registre:

```text
id
name
description
scriptPath interno
enabled
timeoutMs
provider
domain
moduleId
assessmentOrder
visibility
requiredAuthProvider
requiredPermissions
adminConsentRequired
```

Novos providers/domínios/permissões exigem expansão revisada dos schemas compartilhados. O frontend gera cards a partir desses metadados.

Hello World deve permanecer `azure/devops/runtime-validation`, `development`, auth `none`. Microsoft Graph Connectivity é `azure/secops/connectivity-diagnostics`, `public`, auth `microsoft-graph`, permission `User.Read`.

## Escolher o módulo sem editar JSX

1. Escolha um `moduleId` do `ModuleRegistry`, ou registre um módulo central com `id`, `name`, `description`, `order`, `provider` e `domain`.
2. Declare `moduleId` e `assessmentOrder` na entrada real do Assessment Registry. Não duplique nome/descrição/ordem do módulo nessa entrada.
3. O registry exige que provider/domain do módulo correspondam aos do assessment. Ele projeta `moduleName`, `moduleDescription` e `moduleOrder` no catálogo público.
4. Adicione testes de metadata/engine. O Web agrupa e ordena automaticamente; nenhum JSX novo é necessário para criar o card.

Ordens inteiras de 1 a 999, com desempate por ID. Módulos vazios e assessments desabilitados não aparecem. `adminConsentRequired=true` adiciona badge compacto, mas a autorização efetiva continua responsabilidade Entra/API; não infira aprovação apenas pela metadata.

O módulo `identity-visibility` contém `inactive-users` (Mapear Usuários Inativos), com HTML/CSV e permissões de leitura administrativas. `security-assessments` e `protection-response` continuam preparados e vazios. Identity Assessment permanece futuro. Veja [regras e limites do inventário](inactive-users.md).

## Regras obrigatórias

1. Use PowerShell 7 cross-platform.
2. Leia um único contexto com `Read-CloudOpsExecutionContext`.
3. Valide `assessmentId` e somente leia `auth` quando o registry exigir Graph.
4. Emita progresso e métricas públicas por NDJSON em `stderr`.
5. Reserve `stdout` exclusivamente ao ZIP.
6. Construa ZIP/entries em `MemoryStream`/`ZipArchive`; nunca use filesystem, inclusive `/tmp`.
7. Não escreva log, transcript, cache, history, checkpoint ou telemetria de assessment.
8. Não exponha token, tenant, Graph response, PII ou finding detalhado em evento público.
9. Faça HTML encoding de dados dinâmicos.
10. Em falha, use somente códigos/mensagens sanitizados e exit code não zero.
11. Limpe byte arrays/buffers controlados em `finally` e libere referências a tokens cedo.

Evite `Write-Host`, `Write-Output`, `Write-Warning`, `Write-Verbose` e saída implícita. Mesmo um texto em `stdout` corrompe o ZIP.

## Graph

Use `engine/shared/CloudOps.Graph.psm1`, nunca instale Microsoft.Graph PowerShell SDK. Não aceite host, access token, tenant ou scopes de options.

Prefira:

```text
Graph page
  -> agregação/stream de report
  -> descarte da página
```

`Get-CloudOpsGraphCollection` valida `@odata.nextLink`; `Invoke-CloudOpsGraphRequest` já aplica host fixo, response limit, retry e erros seguros. Não registre request/response.

Permissões vêm do registry e devem seguir least privilege. Não adicione permissões futuras ao App Registration antes do assessment correspondente.

Ao ampliar permissões, revise também o consentimento estático `.default`: o popup pode solicitar todo o conjunto configurado na API e tenants existentes podem precisar reconsentir. Nunca acrescente Graph permission ao SPA. Preserve a recuperação limitada, admin approval e o drawer aprovado.

## publicMetrics

Use apenas:

```text
findings
objectsAnalyzed
requestsCompleted
graphReachable
```

Os contadores são inteiros agregados. Tudo que identifica conta, objeto, tenant, grupo, aplicação, política ou evidência pertence exclusivamente ao ZIP.

## Testes

Obrigatório cobrir, conforme aplicável:

- contexto ausente/inválido e auth incompatível;
- NDJSON/schema/progresso;
- ZIP e entries esperadas em memória;
- HTML/JSON seguros;
- nenhum arquivo alterado;
- sucesso, timeout, abort e buffer cleanup;
- Graph 200, 401, 403, 429/Retry-After, 5xx/retry e limites;
- paginação, ciclo e nextLink host inválido;
- ausência de dado detalhado em publicMetrics.

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-GraphModule.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File ./engine/tests/Validate-HelloWorld.ps1
```

Unit tests não chamam Graph real. O E2E Graph real é manual e exige conta/consentimento válidos.
