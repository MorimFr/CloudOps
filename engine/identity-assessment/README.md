# Assessment de Identidade — CIS Wave 1

Primeiro consumidor da CloudOps Assessment SDK. O caminho CIS de produção possui dez controles da Wave 1, quatro collectors compartilhados, Report Standard v1 e narrativa executiva opcional via backend. O manifest está `enabled=true` desde 2026-09-18, por solicitação do operador para testes de laboratório; aceite ainda pendente. A interface exige seleção explícita do perfil CIS. Consulte [escopo e permissões](../../docs/identity-wave1.md), [relatório](../../docs/report-standard-v1.md) e [IA opcional](../../docs/foundry-executive-summary.md).

## Harness de desenvolvimento separado

Os dois control packs DEV sintéticos demonstram o mesmo motor com diferentes parâmetros/frameworks, sem Graph ou LLM. Não devem ser usados como avaliação real de tenant. A execução de desenvolvimento ocorre somente pelo harness interno:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File engine/identity-assessment/tests/Validate-IdentityAssessment.ps1
```

Execute da raiz do repositório, preferencialmente no container de testes, sem rede e com filesystem somente leitura. A fixture fornece contexto SYNTHETIC, timestamp fixo e collectors em memória. Não existe opção HTTP para ativar fixtures ou informar caminhos. A API rejeita a execução pública enquanto o manifest estiver desabilitado.

O relatório offline e o ZIP de quatro arquivos permanecem em RAM; o chamador limpa e descarta o MemoryStream. Configuração estática, código e fixtures não são dados de cliente.

Arquitetura, limites, artefatos e validação: [Identidade](../../docs/identity-assessment.md), [SDK](../../docs/assessment-sdk.md), [Control Packs](../../docs/control-packs.md).
