# Mapear Usuários Inativos

Ferramenta existente de inventário incremental Microsoft Entra, com HTML executivo offline e CSV somente das contas classificadas como inativas. Sua classificação, coleta e relatórios não foram modificados pela migração para plugins.

`assessment.json` declara `inactive-users`, `azure/secops/identity-visibility`, `public`, timeout 3300 segundos e uma execução simultânea por instância. Mantém Graph delegated `User.Read`, `User.Read.All`, `AuditLog.Read.All`, `LicenseAssignment.Read.All` e consentimento administrativo. Manifest não substitui os grants do tenant.

- [Regras de classificação, limitações históricas e permissões](../../docs/inactive-users.md).
- [Desenvolvimento e contrato de plugins](../../docs/assessment-development.md).
- Declaração: `npm run assessments:validate`.
- Regressão: `pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-InactiveUsers.ps1 -ScaleUsers 10000`.
- Escala sintética ampliada: substitua por `-ScaleUsers 200000`.
- HTML responsivo/impressão: `npm run test:reports`.

Todos esses testes usam fixtures sintéticas. Não executar E2E Graph real sem identidade, autorização e consentimento válidos. Tokens, páginas Graph e ZIP permanecem somente em RAM; `assessment.json` é configuração estática do produto.
