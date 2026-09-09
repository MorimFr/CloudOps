# Microsoft Graph Connectivity

O `assessment.json` é a declaração oficial descoberta no startup: `azure/secops/connectivity-diagnostics`, visibilidade `public`, auth Graph `User.Read`, timeout 60 segundos e limite global de concorrência. A migração para manifest não altera `/me`, consentimento/OBO ou scripts. Valide com `npm run assessments:validate`.

Assessment de fundação que comprova acesso delegado ao Microsoft Graph através do fluxo On-Behalf-Of. Ele requer User.Read e executa somente:

~~~http
GET https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName
~~~

O token Graph é recebido de forma transitória em auth.accessToken pelo stdin; nunca é aceito por argumento, variável de ambiente ou arquivo. Os dados de /me aparecem apenas no ZIP entregue ao usuário (report.html e summary.json). O canal público recebe somente graphReachable e requestsCompleted.

O assessment usa REST diretamente por CloudOps.Graph.psm1; o SDK PowerShell Microsoft.Graph não é instalado.

Os testes de transporte Graph ficam em `engine/tests/Validate-GraphModule.ps1`.
O diretório `tests/` documenta a validação manual do fluxo Graph real, que não
é executada no CI por exigir identidade e consentimento de um tenant.
