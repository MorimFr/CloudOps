# Assessment de Identidade — skeleton

Primeiro consumidor da CloudOps Assessment SDK. O manifest está desabilitado; nenhum pack DEV deve ser usado como avaliação real de tenant. Não contém CIS, não chama LLM e não amplia permissões.

Os dois control packs sintéticos demonstram o mesmo motor com diferentes parâmetros/frameworks. A execução de desenvolvimento ocorre somente pelo harness interno:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File engine/identity-assessment/tests/Validate-IdentityAssessment.ps1
```

Execute da raiz do repositório, preferencialmente no container de testes, sem rede e com filesystem somente leitura. A fixture fornece contexto SYNTHETIC, timestamp fixo e collectors em memória. Não existe opção HTTP para ativar fixtures ou informar caminhos. O entrypoint público falha fechado.

O relatório offline e o ZIP de quatro arquivos permanecem em RAM; o chamador limpa e descarta o MemoryStream. Configuração estática, código e fixtures não são dados de cliente.

Arquitetura, limites, artefatos e validação: [Identidade](../../docs/identity-assessment.md), [SDK](../../docs/assessment-sdk.md), [Control Packs](../../docs/control-packs.md).
