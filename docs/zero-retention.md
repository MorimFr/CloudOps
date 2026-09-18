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

Isso inclui `engine/<id>/assessment.json`: configuração estática de produto lida uma vez no startup, sem tokens, tenant data ou resultados. Discovery não cria arquivo, cache persistente ou índice e não executa scripts. Os arquivos temporários dos testes de discovery contêm exclusivamente manifests/scripts sintéticos, são isolados fora do engine real e removidos ao final. Não se aplica esse mecanismo a dados de cliente.

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
- um teste com MSAL real simula login combinado `.default`, reconsentimento `prompt=consent`, aquisição normal `Assessment.Run`, force refresh e nova instância, verificando zero gravações no Web Storage e zero abertura de IndexedDB;
- testes de logging/redaction cobrem Authorization, tokens, secrets e claims;
- testes do Execution Manager cobrem wipe, TTL, download único, abort e cross-user isolation;
- `Validate-HelloWorld.ps1` compara snapshots/hashes do workspace e `/tmp`;
- `Validate-GraphModule.ps1` usa Graph fake em memória e rede desabilitada;
- `Validate-InactiveUsers.ps1` cobre wrapper stdin/ZIP, CSV/HTML, paginação, limites, descarte de ZIP parcial e snapshots de engine/`/tmp`; `-ScaleUsers 200000` gera páginas sintéticas sob demanda, sem rede nem arquivos de resultado;
- CI executa os engines em container read-only/sem rede.

O consentimento combinado não altera a fronteira de confiança: a API continua sendo o único cliente Graph do produto. Diálogo e retry guard guardam apenas metadata/estado de UX em RAM. Testes de navegador usam exclusivamente fixtures sintéticas, com captura de screenshots, traces e vídeo desligada por padrão; nunca rode captura de payload com identidade real.

Os snapshots não detectam um arquivo criado e removido integralmente entre medições e não provam comportamento do host. Eles demonstram, junto ao código e ao filesystem read-only, que os engines não dependem de persistência.

O inventário de inativos não cria checkpoints: guarda GUIDs de deduplicação, agregados, uma amostra limitada e o ZIP comprimido em RAM. Uma falha tardia descarta o ZIP completo. As métricas agregadas são visíveis durante a coleta somente ao proprietário; desaparecem se a execução falhar. HTML/CSV baixados podem conter PII e precisam de proteção e descarte pelo administrador.

## Assessment SDK

Profiles `assessment-sdk.json`, control packs, recomendações e fixtures DEV são configuração/código estático de produto, não resultados de tenant. O discovery faz apenas leitura limitada; não cria índice, arquivo de resultado, cache ou checkpoint. Fixtures temporárias dos testes de configuração são sintéticas e removidas ao final.

O caminho de dados permanece em RAM: página Graph → agregados mínimos do collector → estado normalizado → evidência/findings → ReportModel → quatro entries de ZIP. A SDK não recebe Graph token; apenas o collector específico tem o contexto de autenticação. Evaluator, AI e renderer recebem DTOs separados, sem credenciais. Fatos v1 não contêm registros individuais ou texto Graph.

O sanitizer genérico de IA gera novo objeto com IDs de controles e fatos numéricos/booleanos aprovados. O harness DEV não faz chamadas LLM. Na Wave 1, um provider backend opcional pode chamar Azure OpenAI com uma allowlist separada e ainda menor: catálogo estático, contagens reconciliadas e fatos vazios. Não há logs de prompt/resposta, cache ou histórico. Resultados autoritativos nunca compartilham objeto mutável com a saída consultiva. Provider indisponível ou inválido não impede o relatório. Ver [limites de retenção do provider e configuração](foundry-executive-summary.md): store=false não substitui a revisão das políticas de retenção/abuse monitoring da Microsoft.

Os módulos usam `try/finally`, encerram runspaces e liberam referências. O gerador de ZIP devolve MemoryStream ao chamador, que deve sobrescrever o buffer e descartá-lo em `finally`, inclusive se houver falha. Strings e cópias do runtime continuam sob as limitações best-effort descritas acima; não há promessa de zeroização física verificável.

Validadores da SDK/Identidade rodam sem rede e com filesystem read-only, fixtures de Graph/AI em memória e verificações de ausência de escrita. Playwright recebe HTML/CSV sintéticos por stdout em RAM, valida ausência de requests externos e mantém captura visual opt-in. Não usar esse harness com dados de cliente. Nenhum mecanismo de persistência foi adicionado; perda de processo continua perdendo a execução.
