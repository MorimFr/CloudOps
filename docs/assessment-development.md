# Desenvolvimento de assessments

## Estrutura mínima

```text
engine/<assessment-id>/
|-- Invoke-Assessment.ps1
|-- README.md
|-- knowledge/          # conteúdo estático e não sensível, quando necessário
`-- tests/
```

O diretório só se torna executável depois de uma entrada explícita no Assessment Registry. Nunca derive caminho a partir do input do cliente.

## Regras obrigatórias

1. Usar PowerShell 7 cross-platform; não depender de Windows PowerShell 5.1, COM, Registry, Office ou APIs exclusivas do Windows.
2. Ler exatamente um contexto JSON de `stdin` com `Read-CloudOpsExecutionContext`.
3. Emitir progresso/resumo sanitizado em NDJSON por `stderr` com os helpers compartilhados.
4. Reservar `stdout` exclusivamente para um único artefato binário.
5. Construir ZIP e seus membros inteiramente em memória.
6. Não escrever assessment data em filesystem, cache, histórico, transcript, log ou telemetria.
7. Não imprimir token, opções, resposta Graph, PII ou findings no canal de controle.
8. Validar identificadores e codificar qualquer texto dinâmico inserido em HTML.
9. Propagar falha por evento sanitizado e exit code não zero, sem stack/contexto.
10. Manter a lógica específica dentro do engine, não no backend genérico.

Evite `Write-Host`, `Write-Output`, saída implícita de expressões, `Write-Warning` e `Write-Verbose`. Mesmo uma única linha textual corrompe o ZIP de `stdout`. Use `[void]` ao chamar APIs .NET que possam retornar valores.

## Registro

Uma entrada deve declarar ID, nome público, script fixo, habilitação e timeout. A API publica somente ID, nome, descrição/estado habilitado; o caminho permanece interno. IDs seguem `^[A-Za-z0-9][A-Za-z0-9-]{0,127}$`.

## Testes esperados

- contexto ausente, JSON inválido e assessment ID incompatível falham sem expor input;
- cada linha de `stderr` é NDJSON válido e obedece ao schema;
- os estágios e progressos são monotônicos;
- `stdout` é um ZIP válido com entradas esperadas;
- JSON/HTML internos são válidos e seguros;
- o processo não cria ou altera arquivos de assessment;
- buffers são descartados em sucesso, falha e timeout;
- nenhuma opção recebida altera script ou argumentos do processo.

O teste independente do Hello World pode ser executado sem Pester:

```powershell
pwsh -NoLogo -NoProfile -File ./engine/tests/Validate-HelloWorld.ps1
```

Ele captura os três streams com `System.Diagnostics.Process`, abre o ZIP diretamente de um `MemoryStream` e compara hashes do projeto e, em Linux, de `/tmp`, antes/depois. Dependências estáticas, IPCs e o cache de timing que o próprio `pwsh` atualiza em cada startup são excluídos explicitamente.

## Preparação para Microsoft Graph

Assessments futuros receberão credencial transitória pelo contexto e chamarão Graph REST por um módulo controlado. Isso não autoriza gravar token/resposta, instalar o Microsoft.Graph PowerShell SDK ou adicionar logging de payload. Autenticação e OBO ainda não fazem parte desta etapa.
