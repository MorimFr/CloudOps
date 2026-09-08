# Mapear Usuários Inativos

Ferramenta pública `inactive-users`, em **Azure → SecOps → Visibilidade de segurança de identidade**. Somente leitura, com autenticação delegated/OBO no tenant da sessão. O download único entrega um ZIP com exatamente `report.html` e `usuarios-inativos.csv`. Nenhum arquivo de resultado é gravado no servidor.

## Critério de inatividade

A referência é o instante UTC do início da coleta; o corte inclusivo é referência menos 90 dias completos. Essa referência permanece fixa durante toda a paginação. A observação de cada conta tem um instante separado: um sucesso após o início, mas já ocorrido quando a conta é lida, significa **ativo**, não data futura inválida. O HTML identifica a versão 2 da classificação e a janela de coleta.

| Evidência | Classificação | Entra no CSV? |
| --- | --- | --- |
| Último login bem-sucedido há 90 dias ou mais | Inativo; dias inteiros exatos | Sim |
| Último sucesso há menos de 90 dias | Ativo no período | Não |
| Data de sucesso explicitamente nula em objeto válido; criação há 90 dias ou mais | Inativo, sem sucesso registrado | Sim |
| Data de sucesso explicitamente nula em objeto válido; criação há menos de 90 dias | Período inicial | Não |
| `signInActivity` nulo ou omitido na consulta selecionada; criação há 90 dias ou mais | Inativo operacional, sem histórico registrado | Sim |
| `signInActivity` nulo ou omitido; criação há menos de 90 dias | Período inicial | Não |
| Campo de sucesso omitido dentro do objeto; ambos os campos de tentativas presentes, pelo menos uma data e todas anteriores/iguais ao corte; criação há 90 dias ou mais | Inativo operacional, evidência histórica complementar | Sim, sem inventar dias desde o sucesso |
| Campo de sucesso omitido e tentativas recentes ou insuficientes | Indeterminado; tentativas não informam sucesso ou falha | Não |
| Sem sucesso e sem criação válida, objeto de atividade vazio/inválido ou datas essenciais inconsistentes | Indeterminado, com motivo principal | Não |
| Sucesso válido com criação ausente/malformada | Classificado pelo sucesso, com alerta sobre criação | Somente se inativo |

Usamos `signInActivity.lastSuccessfulSignInDateTime`, que cobre sucessos interativos e não interativos. `lastSignInDateTime` e `lastNonInteractiveSignInDateTime` também contêm tentativas malsucedidas e não comprovam acesso. O histórico de sucesso começou em dezembro de 2023 sem preenchimento retroativo; por isso o CSV diz **“Sem login bem-sucedido registrado”**, não afirma “nunca entrou”. Tentativas antigas podem complementar a análise de histórico legado, mas **não substituem a data de último sucesso nem geram dias exatos no CSV**. Sucesso explicitamente nulo com tentativas recentes segue a regra operacional de criação e recebe alerta para revisão; campo de sucesso omitido com tentativas recentes fica indeterminado. [Semântica oficial](https://learn.microsoft.com/en-us/graph/api/resources/signinactivity?view=graph-rest-1.0).

A Microsoft documenta que `signInActivity` não é retornado para usuários sem login ou com último login anterior a abril de 2020. Por isso, omissão do bloco e `null` explícito usam a mesma regra de idade, **somente na consulta fixa que seleciona atividade e conclui sem erro**. O classificador isolado exige o sinal interno `ActivitySelected` para inferências por ausência; ele não é uma opção da API nem um bypass de autorização. Falhas de autorização, de leitura ou de paginação abortam o assessment e descartam o ZIP parcial. Um objeto vazio, array, valor malformado ou data inválida não vira ausência de histórico. [Propriedade de usuário](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0#properties).

Consulta concluída não garante que o Graph tenha todo o histórico. O HTML mostra quantos blocos de atividade vieram como objeto, nulo, omitido ou inválido; ausência generalizada recebe um aviso de cobertura para validar licenciamento e acesso com o administrador. Não prometemos eliminar todos os indeterminados nem comprovar que uma conta nunca entrou. Os logs detalhados têm retenção diferente do resumo `signInActivity`: não inferimos 90 dias de inatividade apenas pela ausência de eventos em uma janela menor.

Contas sem sucesso precisam aguardar 90 dias desde a criação, conforme a decisão do produto. Não há opção no cliente para mudar o corte, o tenant, o token ou o host Graph.

## CSV

UTF-8 com BOM, delimitador `;`, CRLF e campos entre aspas. Aspas, delimitadores e quebras de linha são escapados. Textos que poderiam virar fórmulas na planilha recebem um apóstrofo de proteção. Somente contas classificadas como inativas são exportadas, sem duplicar IDs entre páginas.

| Coluna | Conteúdo |
| --- | --- |
| Nome | `displayName` |
| UPN | `userPrincipalName`, preservando o UPN real, inclusive `#EXT#` |
| Tipo de Conta | Membro, Convidado ou Não informado |
| Tipo de convidado | Convite pendente, Convite aceito, Estado do convite não informado; membros: Não se aplica |
| Dias sem login bem-sucedido | Dias inteiros desde o último sucesso, ou Sem login bem-sucedido registrado |
| Data Criação (UTC) | ISO 8601 UTC, por exemplo `2025-01-01T00:00:00Z`; desconhecida: Não informada |
| Licenciado | Sim, Não ou Não informado |
| Licença | Nomes/SKUs atribuídos, separados por barra vertical; Sem licença ou Não informada |

O UPN de um convidado não é necessariamente seu e-mail externo. Convites só são aceitos quando `externalUserState=Accepted`; estado nulo não permite essa conclusão. Licença atribuída não garante provisionamento, uso, cobrança nem custo recuperável. [Propriedades de usuário](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0).

Os SKUs são resolvidos uma vez a partir de `/subscribedSkus`. Nomes comuns vêm de `engine/inactive-users/knowledge/license-names.json`; o identificador técnico sempre é preservado. SKU desconhecido mantém `skuPartNumber`, ou GUID se não houver correspondência. Não fazemos lookup externo em runtime. A lista estática é deliberadamente parcial e deve ser revisada com a [referência oficial de produtos](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference).

## Relatório executivo HTML

- Oito indicadores: população, inativos, inativos habilitados/licenciados, convidados, convites pendentes, inativos sem sucesso registrado e desabilitados licenciados.
- Sete gráficos de rosca/pizza com barras comparativas, contagens e denominadores explícitos: atividade, tipos de conta, tipos de inativo, convites, faixas de inatividade, habilitação e licenciamento dos inativos.
- Comparativo de licenças por SKU e indicadores de revisão com responsáveis/patrocinadores.
- Amostra das primeiras 50 contas inativas; o CSV contém a relação completa. A amostra não é ranking de risco.
- Evidência dos inativos em três grupos exclusivos: último sucesso conhecido, ausência de sucesso mais criação e histórico legado de tentativas antigas. A soma corresponde ao total do CSV.
- Motivos principais dos indeterminados, contados sem duplicidade, e amostra de até 50 dessas contas com Nome/UPN/motivo, somente no HTML. Alertas complementares são contados em toda a população e podem se sobrepor.
- Tenant, referência/corte/geração UTC, cobertura, duplicatas, qualidade dos dados e metodologia.
- CSS e SVG locais, sem JavaScript, CDN, fontes, imagens ou rastreadores externos; layout responsivo e impressão. Dados do diretório são codificados para HTML e há CSP restritiva.

Somente os gráficos têm categorias mutuamente exclusivas dentro de sua base. Indicadores como “habilitados” e “licenciados” podem se sobrepor; somá-los não resulta no total. Nenhuma conta é bloqueada, excluída ou alterada pela ferramenta.

## Permissões e preparação do tenant

Configure **Microsoft Graph → Delegated permissions no App Registration da API**, não no Web:

- `User.Read`: identificação básica da organização; já usado pelo diagnóstico.
- `User.Read.All`: inventário de usuários e propriedades selecionadas.
- `AuditLog.Read.All`: atividade de login.
- `LicenseAssignment.Read.All`: consulta dos SKUs para resolver licenças.

As três novas permissões exigem consentimento administrativo. Permissões de escrita e `Directory.Read.All` não são necessárias nesta implementação. A conta executora também precisa ter autorização de leitura no diretório: por exemplo, Reports Reader para atividade e Directory Readers para SKUs, ou outro conjunto de funções permitido pelas APIs. O tenant precisa cumprir os requisitos Entra ID P1/P2 para a atividade. Consentimento do app não substitui a função do usuário. [Requisitos de atividade](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-manage-inactive-user-accounts) · [Permissões e funções de SKUs](https://learn.microsoft.com/en-us/graph/api/subscribedsku-list?view=graph-rest-1.0) · [Organização básica](https://learn.microsoft.com/en-us/graph/api/organization-get?view=graph-rest-1.0).

O consentimento combinado `.default` considera todas as permissões estáticas da API: tenants existentes podem precisar de novo consentimento, mesmo ao entrar por outro card. O Web continua pedindo `Assessment.Run` para chamadas normais; o token Graph nunca chega ao navegador. Não são alterados grants ou credenciais automaticamente. Veja [configuração Entra](entra-setup.md).

## Grandes ambientes: referência de 200 mil usuários

A consulta seleciona somente nove propriedades necessárias e usa `$top=500`. Todas as páginas seguem o `@odata.nextLink` integral retornado pelo Graph, sem fabricar skip tokens e sem interromper ao encontrar uma página curta ou vazia com continuação. Com `signInActivity`, 500 é o máximo documentado; não é possível usar 999 para esta consulta. [Paginação oficial](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0).

Não há consultas de login ou licença por usuário, nem batches N+1. São aproximadamente 400 páginas de usuários para 200 mil contas, mais a consulta da organização e as páginas de SKUs. Toda a população é necessária para os denominadores do relatório; filtrar apenas datas antigas descartaria contas sem histórico e distorceria os totais.

A coleta é sequencial, com pelo menos 6,1 segundos entre inícios de páginas; tempo de rede/processamento é descontado da espera. O Graph documenta 10 requisições/minuto para `signInActivity`, inclusive limite por aplicação entre tenants. Para 200 mil usuários, planeje aproximadamente **41 minutos**, mais atrasos/retries; não é SLA. [Limites oficiais](https://learn.microsoft.com/en-us/graph/throttling-limits).

Cada execução reutiliza um `HttpClient` e suas conexões, sem redirects/cookies. Mantém uma página, contadores, catálogo de SKUs, até 50 linhas de amostra de inativos e 50 de indeterminados, e um conjunto compacto de GUIDs para deduplicação. Motivos/evidências são contadores de um conjunto fixo de códigos, não listas ilimitadas. As linhas inativas são escritas diretamente no stream comprimido do ZIP em RAM, sem reter uma lista de 200 mil objetos nem um CSV integral descomprimido. Uso de memória cresce com GUIDs e ZIP, não é constante. Esta revisão não acrescenta requisições por conta nem consultas extras de logs.

Controles operacionais:

- Até 5 tentativas por requisição para falhas transitórias, com backoff; `Retry-After` é obedecido, sem antecipação. Se exceder 300 segundos, falha segura em vez de retry prematuro.
- Uma execução `inactive-users` por instância da API, inclusive entre tenants; outra recebe `EXECUTION_CAPACITY_REACHED`, sem fila. Isso evita competir internamente pela cota. Outros processos/aplicações ainda podem afetar o throttling; não use múltiplas instâncias para contornar limites.
- Timeout de 55 minutos apenas nesta ferramenta; Hello World e Connectivity preservam seus tempos. Métricas agregadas de objetos/requisições/inativos são atualizadas por página; a porcentagem indica fases, não uma fração exata do tenant.
- Proteções: 1.000 páginas de usuários, 500 mil usuários únicos, 20 páginas de SKUs, 10 mil SKUs, 128 Mi caracteres CSV e ZIP de até 24 MiB. O runtime mantém seu limite padrão de 25 MiB; configuração menor continua soberana. Esses tetos são proteções, não promessa de suportar 500 mil contas dentro de 55 minutos.
- Token OBO efêmero adquirido no início, sem refresh token, checkpoint ou retomada persistente. Expiração antecipada, Conditional Access, revogação, falha de página ou limite causam falha sem artefato parcial. Um tenant de 200 mil ainda precisa de autenticação válida pela duração da coleta; ambientes com políticas de sessão mais curtas exigem validação operacional antes do uso.
- O tenant pode mudar durante a coleta, e a atividade pode ter atraso. Não é um snapshot transacional nem prova de desligamento.

Mantenha a sessão aberta e baixe o ZIP ao terminar; o TTL do artefato começa na conclusão, não no início da coleta. Reiniciar o runtime perde a execução por design.

## Validação

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-InactiveUsers.ps1
pwsh -NoLogo -NoProfile -NonInteractive -File engine/tests/Validate-InactiveUsers.ps1 -ScaleUsers 200000
npm run test:reports
```

O teste de escala gera páginas sintéticas sob demanda, alternando último sucesso, bloco nulo/omitido e histórico legado. Desativa apenas as esperas/rede simulada, percorre parser/classificação/ZIP reais e verifica todas as linhas CSV. Seus tempos não representam latência do Graph. A regressão cobre corte fixo versus observação, datas malformadas/futuras, carência, campos omitidos, tentativas recentes, motivos/alertas, amostras limitadas, CSV exclusivo e descarte após erro tardio. O teste de navegador usa Docker com a imagem `cloudops-runtime:local`, ou `CLOUDOPS_TEST_IMAGE`, e mantém HTML/CSV sintéticos em memória. Screenshots só com `CLOUDOPS_UI_SCREENSHOTS=true`; nunca habilite captura com dados reais.

Teste real de aceite: após configurar e consentir permissões, executar pelo catálogo; conferir tenant/contagens, corte de 90 dias, convites, SKUs e exclusão de contas recém-criadas; abrir HTML sem internet; verificar CSV e download único. Não exportar tokens, HAR, logs de payload ou dados de contas para o repositório.
