# Identity Assessment — Wave 1

Implementação parcial do CIS Microsoft 365 Foundations Benchmark 7.0.0. **Habilitado (`enabled=true`) em 2026-09-18 por solicitação do operador para iniciar os testes de laboratório.** Isso não significa que o aceite foi concluído. Nenhuma permissão de tenant foi concedida e nenhum recurso Foundry foi provisionado. Wave 2 continua fora do escopo.

## Iniciar um teste

Reiniciar a API para recarregar o manifest (ou reconstruir/reiniciar o serviço se estiver em container) e atualizar o frontend. Em **Azure → SecOps → Assessment de Identidade**, selecionar explicitamente **Perfil CIS** e clicar em **Executar**. L1 avalia sete controles; L2 avalia os dez da Wave 1. A seleção não detecta nem altera licenciamento. O mesmo perfil é preservado se houver repetição após consentimento.

A habilitação usa as regras de autenticação existentes; o rótulo de laboratório não constitui restrição automática a um Tenant ID. Executar somente nos ambientes autorizados para teste.

## Fonte e cobertura

Fonte: blueprint em `docs/cis/` e PDF autorizado conferido localmente, SHA-256 `17bc3e4e19b274c481287c35f739a12f0312da2322a5395b9927c39080da105b`. O PDF não foi copiado. Requisitos e perfis não foram reinterpretados; mudanças desta fase são a implementação executável, projeção de relatório e integração consultiva opcional.

Pack `cis-m365-identity-wave1` 1.0.0 em `control-packs/cis-m365-7-0-0/identity-wave1.json`, pin validado na definição. O loader admite no máximo um diretório versionado, valida cada segmento contra links/escape e não faz discovery recursivo de JSON arbitrário. SDK continua `cloudops.assessment-sdk.v1`; dez evaluators 1.0.0, separados e executados na linguagem pura/isolada existente.

| CIS ID | Fato / estado esperado | Collector | Risco base CloudOps |
| --- | --- | --- | --- |
| 5.1.2.2 | allowedToCreateApps=false | authorization-policy | HIGH |
| 5.1.2.3 | allowedToCreateTenants=false | authorization-policy | MEDIUM |
| 5.1.3.1 | allowedToCreateSecurityGroups=false | authorization-policy | MEDIUM |
| 5.1.3.4 | EnableGroupCreation=false | group-settings | LOW |
| 5.1.4.2 | userDeviceQuota entre 0 e 10 | device-registration-policy | LOW |
| 5.1.4.5 | localAdminPassword.isEnabled=true | device-registration-policy | HIGH |
| 5.1.4.6 | allowedToReadBitlockerKeysForOwnedDevice=false | authorization-policy | HIGH |
| 5.1.5.2 | adminConsentRequestPolicy.isEnabled=true | admin-consent-policy | MEDIUM |
| 5.1.6.2 | convidado limitado ou restrito; ambas as categorias aceitas | authorization-policy | HIGH |
| 5.1.6.3 | adminsAndGuestInviters ou none | authorization-policy | MEDIUM |

As severidades acima são decisões de priorização **CloudOps**, não afirmações de que o CIS fornece severidades. HIGH prioriza permissões de aplicações/segredos e exposição do diretório; MEDIUM governança de criação/consentimento/convites; LOW restrições de provisionamento e quota. Todos os riskSignals adicionais permanecem false: uma configuração, isoladamente, não comprova exposição concreta, identidade privilegiada ou controle compensatório. A fixture 0 CRITICAL / 4 HIGH / 2 MEDIUM / 1 LOW testa os resultados reais desse Risk Engine, sem IA.

`cisProfile` deve ser explícito: `E3_L1`, `E3_L2`, `E5_L1` ou `E5_L2`. Level 1 seleciona sete controles; Level 2 inclui os dez. 5.1.3.4, 5.1.4.6 e 5.1.6.3 são Level 2. Fora da seleção não significa NOT_APPLICABLE. O perfil selecionado não comprova licenças atribuídas ao tenant. Os outros 61 controles do inventário Identity não foram implementados nem executados.

## Coleta e semântica

Somente `CloudOps.Graph.psm1`, REST v1.0 GET. Três leituras singleton e uma coleção `groupSettings`, deduplicadas pelo planner. Level 1 não chama o collector exclusivo de Level 2. Custo independente dos 200.000 usuários: não são lidos `/users`, logs, licenças, chaves BitLocker ou senhas LAPS. `requestCount` conta páginas lógicas concluídas, não tentativas HTTP.

`groupSettings` percorre até 100 páginas, inclusive página vazia com nextLink. Host, versão, rota e continuidade são limitados; duplicidade, truncamento, propriedade ausente, tipo inválido ou enum desconhecido não geram FAIL. Os limites e retries são finitos e o runtime encerra o processo no cancelamento/timeout.

- Template Group.Unified ausente **na coleção completa** é FAIL, conforme a fonte. Sua evidência registra contagem zero, completude e default efetivo. Template/chave duplicados ou chave ausente são UNKNOWN.
- Quota 0 é válida; não significa ilimitado. Números negativos, fracionários e strings não são convertidos em quota válida.
- Ausência de revisores/notificações não acrescenta requisito de FAIL ao controle de consentimento.
- 401/403 são cobertura insuficiente (UNKNOWN); erro técnico irrecuperável é ERROR. Nenhum erro de API é um gap.
- Nenhum dos dez controles tem hipótese de dispensa automática por licença, permissão, falta de dados ou capability indisponível. Esses casos não produzem NOT_APPLICABLE.
- Toda evidência de FAIL contém valores observados e esperados escalares. Nomes e IDs de objetos Graph não entram no estado normalizado.

## Alterações manuais no Entra

No **CloudOps API App Registration**, em **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, adicionar:

1. `GroupSettings.Read.All`.
2. `Policy.Read.All`.

Conceder **admin consent** no tenant de laboratório com uma identidade autorizada. Preservar permissões existentes exigidas pelos outros assessments; esta Wave 1 não precisa de `User.Read.All`, `AuditLog.Read.All`, `LicenseAssignment.Read.All` ou scopes de escrita. Não adicionar permissões Application como substituto: o fluxo atual é delegado/OBO.

O usuário conectado também precisa de papel compatível. **Global Reader** cobre as leituras restritas de device policy, admin consent e group settings; validar o papel efetivo/PIM e as respostas em laboratório. Consentimento de aplicação e papel do usuário são verificações distintas. Renovar autenticação/consentimento se o token anterior não carregar os novos scopes.

Fontes: [authorizationPolicy](https://learn.microsoft.com/en-us/graph/api/authorizationpolicy-get?view=graph-rest-1.0), [groupSettings](https://learn.microsoft.com/en-us/graph/api/group-list-settings?view=graph-rest-1.0), [deviceRegistrationPolicy](https://learn.microsoft.com/en-us/graph/api/deviceregistrationpolicy-get?view=graph-rest-1.0), [adminConsentRequestPolicy](https://learn.microsoft.com/en-us/graph/api/adminconsentrequestpolicy-get?view=graph-rest-1.0). Policy.Read.All já é necessário para outras leituras e é alternativa delegada documentada a Policy.Read.DeviceConfiguration; não se adiciona esse último scope.

Q-GROUP-PERM e Q-GROUP-LICENSE do blueprint permanecem gates de laboratório: confirmar disponibilidade do scope no catálogo do tenant e requisitos comerciais da restrição de criação de grupos. Se o scope não estiver disponível, não ampliar para Directory.Read.All/Group.Read.All sem revisão e autorização.

## Relatório e aceite

Resultados da suíte local e inventário de arquivos: [registro de validação](identity-wave1-validation.md).

Ver [CloudOps Report Standard v1](report-standard-v1.md) e [configuração Foundry](foundry-executive-summary.md). O nome da organização é rótulo opcional informado pelo operador (`organizationName`), explicitamente não uma consulta `/organization`; o Tenant ID vem da autenticação. Não são solicitados scopes adicionais apenas para enriquecer o cabeçalho. Licenciamento aparece como não inventariado.

Em laboratório, comparar cada observação com a UI e a página CIS, incluindo ambos os estados aceitos dos controles de convidados. Conferir perfis L1/L2, quatro arquivos ZIP, contagens, recomendações e falhas de permissão. Não alterar a configuração real só para produzir uma fixture e não encaminhar artifacts com dados reais à CI.

O catálogo habilitado aponta para o entrypoint real. Não existe opção HTTP para ativar fixtures. Invocações técnicas de laboratório devem fornecer contexto seguro por stdin, perfil explícito e autorização de leitura; nunca colocar token em argumentos, arquivos, logs ou histórico do shell. A autorização para testes não representa aceite de produção.

Próximo passo: **Lab tenant acceptance of Wave 1**.
