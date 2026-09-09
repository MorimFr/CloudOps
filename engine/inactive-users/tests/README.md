# Regressão do plugin de usuários inativos

A suíte existente permanece centralizada em `engine/tests/Validate-InactiveUsers.ps1`; não foi movida nem modificada nesta migração. Cobre classificação, evidências, carência, CSV/HTML seguros, paginação sintética e ausência de gravações. Os testes de HTML estão em `tests/reports/`.

A descoberta do manifest real e os limites/permissões preservados são conferidos pelos testes de discovery/registry em `apps/api/test/`. Execute `npm run assessments:validate` e os comandos no README do assessment.
