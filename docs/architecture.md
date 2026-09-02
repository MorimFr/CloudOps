# Arquitetura do CloudOps v2

## Objetivo desta fundação

Esta etapa prova o caminho de execução real entre navegador, Node.js e PowerShell 7 sem autenticação Microsoft Entra, Microsoft Graph ou qualquer serviço persistente.

```text
CloudOps Web (React/Vite)
          |
          | HTTP local (HTTPS no deployment), JSON/download binário
          v
CloudOps API (Fastify)
          |
          v
Assessment Registry
          |
          v
PowerShell Runtime (processo filho)
          |
          v
Assessment Engine
```

No ambiente local, Web e API são serviços Docker separados. A API e o engine estão na mesma imagem de runtime Linux, de modo que `pwsh` é executado diretamente, sem shell intermediário e sob o mesmo usuário não privilegiado da API.

## Componentes

### CloudOps Web

Lista apenas a visão pública do registry, inicia uma execução por `assessmentId`, consulta o status em intervalos curtos e baixa o artefato quando disponível. Estado de execução e `Blob` existem somente na memória da página. O frontend não conhece caminhos de scripts e não usa `localStorage`, `sessionStorage`, IndexedDB ou Service Worker Cache para dados de assessment.

### CloudOps API

Valida requisições, aplica CORS e headers de segurança, limita concorrência e mantém estados e artefatos em estruturas em memória. Um restart perde todas as execuções por design. O API nunca interpreta lógica específica de um assessment.

### Assessment Registry

É a única fonte de mapeamento entre um `assessmentId` público e um script aprovado. Um cliente nunca envia caminho, comando ou argumentos de processo. Um ID desconhecido é recusado antes de iniciar PowerShell.

### PowerShell Runtime

Inicia `pwsh` com executável e argumentos fixos, `shell: false`, timeout e canais separados. O contexto JSON segue por `stdin`; eventos de controle NDJSON seguem por `stderr`; somente o ZIP binário segue por `stdout`. Saída inválida ou processo malsucedido produz erro público sanitizado e descarte dos buffers.

### Assessment Engine

Cada assessment é um script PowerShell 7 independente que reutiliza os módulos em `engine/shared`. O `hello-world` simula etapas e produz `report.html` e `summary.json` dentro de um `ZipArchive` sobre `MemoryStream`. Não há arquivo intermediário.

## Ciclo de uma execução

```text
POST execution
  -> CREATED/STARTING
  -> processo pwsh
  -> RUNNING + eventos de progresso
  -> COMPLETED + Buffer ZIP em RAM
  -> download único ou TTL
  -> wipe best-effort do Buffer
  -> EXPIRED/remoção
```

O status HTTP contém metadados operacionais não sensíveis; o conteúdo detalhado fica somente no artefato. O download usa `Cache-Control: no-store` e consome o artefato. A limpeza com `Buffer.fill(0)` reduz a janela de exposição, mas não é apresentada como garantia criptográfica sobre cópias internas ou garbage collection.

## Limites de confiança e segurança

- O body é pequeno e validado; `assessmentId` nunca vira um caminho.
- O processo filho não usa interpolação de shell.
- Logs aceitam identificadores de execução, status, estágio, progresso, duração e códigos sanitizados; não aceitam request body, contexto PowerShell, artifact, tokens ou dados de tenant.
- A API usa usuário non-root, capabilities removidas e filesystem read-only no Compose.
- Não existem banco, cache persistente, fila persistente, storage ou volume de dados.

## Evolução prevista

A próxima camada arquitetural adicionará autenticação Microsoft Entra na Web e na API e fluxo On-Behalf-Of para chamadas REST ao Microsoft Graph. A implantação futura alvo é Azure Container Apps. Esses componentes não estão implementados nesta fundação e deverão preservar o mesmo contrato e a política de zero retention.
