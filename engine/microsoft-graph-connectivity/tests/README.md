# Testes do assessment

O transporte, retry, paginação, host pinning, response limit e erros seguros são
testados sem rede por `engine/tests/Validate-GraphModule.ps1`.

O teste deste assessment completo é intencionalmente manual porque sucesso real
precisa provar OBO e `GET /me` contra Microsoft Graph, sem simular credenciais:

1. configure os dois App Registrations descritos em `docs/entra-setup.md`;
2. inicie `docker compose up --build`;
3. autentique uma conta organizacional;
4. abra Azure → SecOps → Microsoft Graph Connectivity;
5. execute e baixe o ZIP;
6. confirme `report.html`, `summary.json`, download único e ausência de dados
   Graph em logs/storage.

O CI nunca recebe token, tenant credential ou client secret para esse teste.
