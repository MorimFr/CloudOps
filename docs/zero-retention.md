# Zero Retention

Zero retention é uma política obrigatória do código da aplicação: dados de assessments não são deliberadamente persistidos. A plataforma funciona mesmo sem banco, storage, Redis, fila durável ou filesystem gravável para relatórios.

## Permitido

- dados em trânsito pelo canal de rede;
- contexto, respostas futuras do Graph e resultados na RAM do processo durante uma execução;
- ZIP em um `Buffer` da API até download único ou expiração;
- estado e `Blob URL` na memória da página pelo tempo necessário ao download;
- arquivo que o usuário escolheu explicitamente baixar.

## Proibido

- banco de dados, storage de objetos, cache ou fila persistente;
- relatório, resposta Graph, payload ou checkpoint no filesystem;
- uso de `/tmp`, `/var/tmp` ou diretório do projeto para dados de assessment;
- `localStorage`, `sessionStorage`, IndexedDB ou Service Worker Cache para execução/artefato;
- tokens, bodies, artefatos, findings ou identificadores de tenant em logs e telemetria;
- dump de `stdin`, `stdout` ou ambiente em mensagens de erro.

Arquivos estáticos — código-fonte, módulos, catálogo e configuração — não são dados de assessment e fazem parte normal da imagem.

## Controles implementados

1. O Execution Manager usa apenas um `Map` em memória; não há adapter de persistência.
2. O PowerShell monta o ZIP com `MemoryStream`/`ZipArchive` e grava os bytes diretamente em `stdout`.
3. A API acumula `stdout` diretamente em `Buffer`, sem arquivo temporário.
4. O artefato expira pelo TTL (300 segundos por padrão) e é consumido após o primeiro download bem-sucedido.
5. Buffers controlados pela aplicação são sobrescritos com zeros antes de a referência ser liberada, quando possível.
6. O frontend revoga a `Blob URL` logo após iniciar o download.
7. Respostas da API usam `Cache-Control: no-store`; downloads também usam headers anti-cache adicionais.
8. Logging possui redaction de credenciais e não registra bodies ou conteúdo dos canais PowerShell.
9. O Compose não declara volumes. A API usa root filesystem read-only. Seu `HOME` aponta para um `/tmp` em `tmpfs` pequeno, destinado exclusivamente à inicialização e a caches internos não sensíveis do Node/PowerShell, nunca a assessment data.

O container Web de desenvolvimento possui uma camada gravável efêmera porque o Vite pode criar cache de build. O serviço Web não recebe o ZIP: o navegador baixa diretamente da API. Essa camada não é volume persistente nem autorização para guardar dados de assessment.

## Validação de ausência de arquivos

`engine/tests/Validate-HelloWorld.ps1` executa o assessment real em um processo filho, mantém `stdout` em memória, valida o ZIP e compara hashes dos arquivos do projeto e, no Linux, de `/tmp`, antes/depois. Dependências estáticas em `node_modules`, IPCs do runtime e o arquivo de timing `StartupProfileData-NonInteractive` que o próprio `pwsh` reescreve a cada inicialização são excluídos. Em conjunto com o root filesystem read-only do runtime, isso demonstra que o nosso Hello World não cria ou altera arquivos de assessment nos locais graváveis do container. Não prova que sistema operacional, container host ou ferramentas externas jamais escrevam metadados próprios, nem detecta uma escrita criada e apagada integralmente entre os dois snapshots.

## Limitações conhecidas

- RAM pode ser inspecionada se host, processo ou plataforma estiver comprometido.
- Runtime, kernel, hipervisor e navegador podem ter comportamentos fora do controle do código da aplicação, inclusive paginação, snapshots e diagnósticos da plataforma.
- Sobrescrever um Buffer é best-effort: cópias internas e garbage collection não oferecem apagamento físico instantâneo verificável.
- Crash ou restart descarta o estado e torna a execução irrecuperável; isso é esperado.
- Depois do download, proteção e descarte do arquivo passam a ser responsabilidade do usuário.
- Operadores não devem habilitar dumps, tracing de payloads, proxy cache, gravação de bodies ou telemetria que capture conteúdo de assessment.

Zero retention não significa desaparecimento físico instantâneo de cada byte. Significa que a aplicação não cria uma via intencional de retenção e reduz explicitamente a janela de exposição em memória.
