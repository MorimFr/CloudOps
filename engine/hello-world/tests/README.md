# Regressão do plugin Hello World

O validador existente `engine/tests/Validate-HelloWorld.ps1` cobre o engine real, stdout ZIP, stderr NDJSON e snapshots sem gravações. Ele permanece no caminho central para manter o fluxo de CI anterior.

`npm run test:e2e:local` acrescenta HTTP autenticado com identidade sintética em RAM, discovery real, execução PowerShell e download-once. Exige `pwsh`, não exige credenciais Microsoft e não chama Entra/Graph. O harness fica apenas em `apps/api/test/hello-world.e2e.ts`, fora do build da API de produção.
