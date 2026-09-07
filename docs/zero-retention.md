# Zero Retention

Zero Retention significa que o código da aplicação não cria uma via intencional de persistência para tokens, Graph data, findings ou artefatos. Não significa apagamento físico instantâneo verificável de cada cópia gerenciada.

## Dados e credenciais transitórios

```text
Microsoft identity tokens: RAM only
CloudOps API access tokens: RAM only
Graph tokens: RAM only
OBO token cache: memory-only
MSAL browser token and temporary cache: memory-only
Graph responses: RAM only
Execution state: RAM only
ZIP server-side: RAM only até download único/TTL
```

O arquivo explicitamente escolhido pelo usuário no browser é a única persistência intencional de resultado.

## Proibido

- database, blob/object storage, Redis, persistent queue ou durable cache;
- relatório, Graph response, payload ou checkpoint em filesystem;
- fallback em `/tmp`, `/var/tmp` ou workspace;
- localStorage, sessionStorage, IndexedDB ou Service Worker Cache para auth, Graph data, execution results ou artifacts;
- token em URL, query, body público, state público, log ou telemetry;
- request/response Graph, claims challenge, auth header ou client secret em logs;
- dump de stdin/stdout/ambiente em erro.

Código, documentação, registry e configuração estáticos fazem parte da imagem e não são dados de assessment. O `.env` local com client secret é uma credencial operacional sob responsabilidade do desenvolvedor, ignorada pelo Git; ele nunca é enviado ao Web.

## Controles

1. MSAL Browser LTS usa `BrowserCacheLocation.MemoryStorage` para tokens e cache temporário; migração de cache e cookies estão desabilitados.
2. A API valida tokens sem persisti-los; metadata/JWKS ficam em RAM. Cada troca OBO cria seu próprio client, usa `skipCache`, aborta por deadline e limpa o cache ao terminar.
3. O Graph token OBO não entra em `ExecutionState`; é passado somente por stdin e referências são liberadas cedo.
4. Ownership usa chave derivada, não identidade legível no estado público.
5. O Execution Manager usa `Map` e timers em memória.
6. PowerShell usa `MemoryStream`/`ZipArchive` e stdout binário.
7. Graph responses possuem byte limit e buffers temporários limpos best-effort.
8. `publicMetrics` é uma allowlist de agregados; PII e Graph details ficam somente no ZIP.
9. Download transfere uma lease, é único e limpa o Buffer em `finish`, `close` ou `error`.
10. TTL, falha, abort, shutdown e dispose executam cleanup.
11. Responses usam `Cache-Control: no-store`; download acrescenta `no-cache`, `Pragma` e `Expires`.
12. Logs registram somente lifecycle/IDs operacionais/códigos seguros, com redaction defensiva.
13. Runtime Docker é non-root, read-only, sem capabilities/volumes; `/tmp` é tmpfs pequeno.

## Limites

- RAM pode ser inspecionada se host, runtime ou processo estiver comprometido.
- Strings JavaScript/.NET/PowerShell são gerenciadas e não podem ser zeradas de forma confiável.
- `Buffer.fill(0)`/`Array.Clear` são best-effort; cópias internas e garbage collection podem sobreviver temporariamente.
- Kernel, hipervisor, navegador e plataforma podem produzir swap, snapshot, crash dump ou diagnóstico fora do controle do app.
- O cache em memória do MSAL se perde no refresh; novo login pode ser necessário.
- A linha MSAL Browser LTS foi selecionada porque a v5 removeu o controle público do cache temporário. Migrar de major exige revalidar o teste de armazenamento com a biblioteca real.
- Um restart perde executions e artefatos, intencionalmente.
- Depois do download, descarte/proteção do arquivo é responsabilidade do usuário.
- Operadores não devem habilitar proxy cache, body logging, dumps ou tracing de payload.

## Validação

- testes frontend escaneiam módulos críticos contra APIs de storage persistente;
- um teste com MSAL real simula login popup, tokens, aquisição silenciosa e nova instância, verificando zero gravações no Web Storage e zero abertura de IndexedDB;
- testes de logging/redaction cobrem Authorization, tokens, secrets e claims;
- testes do Execution Manager cobrem wipe, TTL, download único, abort e cross-user isolation;
- `Validate-HelloWorld.ps1` compara snapshots/hashes do workspace e `/tmp`;
- `Validate-GraphModule.ps1` usa Graph fake em memória e rede desabilitada;
- CI executa os engines em container read-only/sem rede.

Os snapshots não detectam um arquivo criado e removido integralmente entre medições e não provam comportamento do host. Eles demonstram, junto ao código e ao filesystem read-only, que os engines não dependem de persistência.
