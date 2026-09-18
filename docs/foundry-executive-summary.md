# Resumo executivo opcional — Microsoft Foundry / Azure OpenAI

O relatório sempre funciona sem IA. Provider ausente, configuração incompleta/inválida, falha de autenticação/rede, timeout, 429/5xx, JSON inválido, recusa ou violação de schema produzem a narrativa determinística e a nota discreta: **Resumo executivo gerado sem enriquecimento de IA.** Falha opcional de IA não altera status de execução concluída; cancelamento explícito do assessment continua cancelamento.

## Configuração manual

Nenhum recurso Azure foi provisionado, nenhum RBAC foi atribuído e nenhuma chave foi criada nesta entrega.

1. Selecionar/criar manualmente um recurso Azure OpenAI/Foundry com endpoint de recurso `https://NOME.openai.azure.com` e suporte ao endpoint Responses v1. Esta versão não aceita project endpoints, proxies arbitrários ou clouds soberanas.
2. Criar um deployment de **gpt-5.4-mini**, preferencialmente. Confirmar disponibilidade, quota, região e suporte a Structured Outputs no próprio recurso; o nome do deployment pode ser diferente do modelo. Não há modelo nem deployment hardcoded no provider. Sem disponibilidade, manter a IA desabilitada até uma escolha aprovada.
3. Habilitar Managed Identity na hospedagem do **backend CloudOps API**. Usar identidade system-assigned ou informar client ID de uma user-assigned anexada à hospedagem.
4. Em IAM do recurso Azure OpenAI, atribuir **Cognitive Services OpenAI User** à identidade do backend, no escopo do recurso, e validar inferência Entra em laboratório. Não conceder acesso ao frontend, ao usuário conectado ou ao App Registration Graph para esse fim. [Autenticação keyless e RBAC](https://learn.microsoft.com/en-us/azure/developer/ai/keyless-connections).
5. Configurar apenas no backend:

```dotenv
CLOUDOPS_AI_PROVIDER=azure-foundry
CLOUDOPS_AI_ENDPOINT=https://SEU-RECURSO.openai.azure.com
CLOUDOPS_AI_DEPLOYMENT=NOME-DO-SEU-DEPLOYMENT
CLOUDOPS_AI_TIMEOUT_SECONDS=20
CLOUDOPS_AI_MANAGED_IDENTITY_CLIENT_ID=
```

O endpoint é uma origem HTTPS sem path, query, fragmento, credenciais ou porta personalizada. A API acrescenta `/openai/v1/responses`; redirects são rejeitados. Não usar prefixo VITE_. Deixar provider vazio desabilita o enriquecimento. Não há fallback automático para API key, CLI login, client secret ou token Graph. A implementação usa ManagedIdentityCredential explicitamente, não DefaultAzureCredential. Fora de uma hospedagem com MI, os testes usam provider/token fake e a aplicação usa fallback determinístico.

## Chamada e autoridade

Uma chamada privada por execução Identity, após o Risk Engine e antes do ZIP: engine → novo DTO sanitizado → backend → Azure OpenAI → quatro campos narrativos → renderer. O contexto Identity usa NDJSON privado bidirecional; os demais assessments preservam EOF. Nenhum evento AI chega ao frontend, SSE, ExecutionState, snapshots ou logs. Endpoint, deployment e token não entram no contexto PowerShell.

Responses API com `store=false`, `background=false`, sem threads, previous_response_id, conversation, tools, files, vector stores, histórico ou stored completion. Autenticação bearer Entra com escopo `https://ai.azure.com/.default`, conforme a documentação atual de [Responses no Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses). Não foi feita chamada real para validar recurso/deployment nesta etapa.

Schema estrito, `additionalProperties=false`, com exatamente `executiveSummary: string`, `keyRiskThemes: string[]`, `priorityNarrative: string`, `managementConclusion: string`. Resposta é revalidada no backend e no engine; limites de strings/listas/bytes e HTML encoding são aplicados. Campos de status, risco, evidência, observed, expected, recomendações, CIS, perfil ou cobertura são rejeitados, nunca mesclados ao resultado autoritativo. A narrativa ainda exige revisão humana e pode conter imprecisões; o schema não prova veracidade factual.

Timeout absoluto **20 segundos**, configurável de 15 a 30, incluindo autenticação, HTTP, leitura e eventual retry. No máximo **um retry** para 429/500/502/503/504; Retry-After só é aguardado se couber no prazo. O SDK de autenticação tem retries adicionais desabilitados. O runtime possui guarda de 30 segundos e o engine espera no máximo 31 segundos pela resposta privada. Avaliação não fica aguardando IA por minutos.

## Allowlist e retenção

Enviados: framework/version, perfil, contagens reconciliadas de controles/status/severidade, IDs dos dez controles, áreas fixas, status, severidade e rótulos fixos curtos de gap. `facts` é intencionalmente **vazio** nesta primeira versão; nenhum fato Graph é necessário à narrativa inicial. Labels para resultados sem FAIL são `no-confirmed-gap`.

Proibidos: Tenant ID/nome, tokens Graph/CloudOps, UPN/email/displayName, IDs/nomes de usuários, grupos, políticas ou aplicações, raw Graph, headers e segredos. A projeção reconstrói o DTO, e o backend valida catálogo, labels, perfil e reconciliação; não depende apenas de apagar algumas propriedades de um objeto maior.

Aplicação: sem cache de IA, log de prompt/completion, histórico, DB, filesystem de resultados ou findings em telemetria. Objetos vivem em RAM; buffers são limpos quando possível e referências são liberadas ao terminar. Credentials podem manter cache transitório de token em memória; nenhum cache persistente é habilitado. Não ativar captura HTTP, dumps, body logging ou tracing de payload na hospedagem. O artefato final segue o TTL/download único já existente e o destinatário controla sua cópia baixada.

**`store=false` não é garantia de zero retenção do fornecedor.** Políticas de monitoramento de abuso e retenção operacional da Microsoft são uma fronteira diferente da aplicação. Revisar termos, região e configurações do recurso, inclusive elegibilidade para modified abuse monitoring, antes do laboratório com dados reais. [Privacidade e processamento no Azure](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy).

## Validação sem credenciais

Contratos e provider fake cobrem resposta válida, timeout, cancelamento, 429/5xx, limites, JSON inválido, schema e campos proibidos. Runtime fake cobre troca privada, fallback, bloqueio fora de Identity e duplicação. `npm run test:e2e:local` também exercita PowerShell real com provider válido, ausente, indisponível e inválido, verifica os CSVs autoritativos byte a byte e simula um backend que nunca responde. O engine compartilha um StreamReader assíncrono entre contexto e resposta, sem usar `Console.In.ReadLineAsync`, que [executa sincronamente](https://learn.microsoft.com/en-us/dotnet/api/system.io.textreader.readlineasync?view=net-10.0). PowerShell e Playwright validam encoding, relatório offline e layouts. CI não precisa de login, MI, API key nem Foundry real.
