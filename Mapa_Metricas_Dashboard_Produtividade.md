# Mapa de Métricas — Dashboard e Produtividade

Data da auditoria: 09/10/2026
Escopo auditado: `V2Dashboard`, `V2Productivity`, `AnalyticsFilters`, `analyticsService`, `analyticsDomain`, `analyticsScopePolicy` e procedimentos V2.

## Contrato de leitura

| Tela | Pergunta que responde | Unidade principal | Próxima ação |
| --- | --- | --- | --- |
| Dashboard | Como está a operação e onde preciso agir? | operação, base, campanha e PDV | Leads ou Follow-ups filtrados |
| Produtividade | Quem está executando bem ou mal e por quê? | vendedor executor | detalhe do vendedor, Leads ou Follow-ups |
| Leads / Follow-ups | Quais casos exigem ação? | Lead e tarefa | intervenção operacional autorizada |

## Contexto, período e autorização

- As duas telas recebem `preset`, `fromDate`, `toDate`, `campaignId`, `pdvId` e `sellerMembershipId` por `AnalyticsFilters` e preservam esse estado na URL.
- A opção visual **Todos** envia `undefined`, não uma lista vazia; portanto não gera `IN ()`.
- O período é calculado no servidor no fuso configurado do parceiro, como intervalo `[início, próximo início)`. O período anterior tem a mesma duração.
- Todas as consultas criam `PartnerContext` e aplicam `partnerId`, exclusão de Leads removidos, escopo de PDVs e, para vendedor, o próprio `membershipId`.
- Super Admin, Admin do Parceiro e escopo `ALL` consultam o parceiro inteiro; Manager e Gestão `SPECIFIC` mantêm allowlist explícita de PDVs; vendedor fica restrito ao próprio vínculo.
- Filtros solicitados fora do parceiro, PDV ou vendedor autorizado são rejeitados no backend.

## Vocabulário oficial de fatos

| Conceito | Definição atual | Fonte | Unidade |
| --- | --- | --- | --- |
| Leads recebidos | Leads com `receivedAt` no período | `leads` | Lead distinto |
| Leads trabalhados | Lead com ao menos um evento `contact_attempted` ou `effective_contact_recorded` no período | `lead_timeline_events` | Lead distinto |
| Leads com tentativa | Lead com ao menos uma tentativa no período | `lead_contact_attempts` | Lead distinto |
| Tentativas | Registros de tentativa ocorridos no período | `lead_contact_attempts` | Evento |
| Leads com contato efetivo | Lead com ao menos uma tratativa efetiva no período | `lead_contacts`, `recordKind = effective_contact` | Lead distinto |
| Contatos efetivos | Registros de tratativa efetiva no período | `lead_contacts`, `recordKind = effective_contact` | Evento |
| Interessados | Lead distinto com tratativa efetiva cujo resultado é `interested` no período | `lead_contacts` | Lead distinto / classificação comercial |
| Conversões | Eventos históricos de conversão no período | `lead_conversions` | Evento |
| Leads convertidos | Lead distinto com conversão no período | `lead_conversions` | Lead distinto |
| Tempo até 1ª tentativa | Média de `firstAttemptAt - receivedAt`, para primeiros fatos ocorridos no período | `leads.firstAttemptAt` | Média em segundos |
| Tempo até 1º contato | Média de `firstEffectiveContactAt - receivedAt`, para primeiros fatos ocorridos no período | `leads.firstEffectiveContactAt` | Média em segundos |
| Follow-up vencido | Follow-up `pending` com vencimento anterior a agora | `follow_ups` | Snapshot atual |

### Distinção obrigatória

`Tentativas` nunca significa `Leads com tentativa`.

```
Tentativas médias por Lead tentado = tentativas (eventos) / Leads distintos com tentativa
```

`Leads trabalhados` é a união de Leads com tentativa e Leads com contato efetivo no período; um mesmo Lead conta uma única vez.

## Dashboard atual — métricas, fórmulas e limites

| Métrica atual | Fórmula/denominador | Universo temporal | Tela/bloco | Observação de redesign |
| --- | --- | --- | --- | --- |
| Leads recebidos | `count(leads)` | recebidos no período | KPI | manter como volume de entrada |
| Leads trabalhados | `countDistinct(timeline.leadId)` para os dois fatos operacionais | eventos no período | KPI | migrar para detalhe de Cobertura de trabalho |
| Tentativas | `count(attempts)` | eventos no período | KPI | secundária: esforço, não alcance |
| Contatos efetivos | `count(contacts)` | eventos no período | KPI | volume secundário; taxa usa Leads distintos |
| Conversões | `count(conversions)` | eventos no período | KPI | volume secundário; taxa usa Leads distintos |
| Taxa de contato | Leads distintos com contato / Leads trabalhados | eventos no período | eficiência | KPI executivo proposto |
| Taxa de conversão | Leads distintos convertidos / Leads distintos com contato | eventos no período | eficiência | KPI executivo proposto |
| Interessados | Leads distintos com resultado `interested` | eventos no período | eficiência | classificação, não etapa obrigatória |
| Tempo até 1ª tentativa | média de primeiro fato - recebimento | primeiros fatos no período | eficiência | manter com rótulo sem alegar mediana |
| Tempo até 1º contato | média de primeiro contato - recebimento | primeiros fatos no período | eficiência | manter com rótulo sem alegar mediana |
| Sem responsável | Lead não terminal sem responsável | snapshot atual | Saúde | ponto de atenção acionável |
| Sem trabalho | Lead atribuído, não terminal, sem primeiro fato | snapshot atual | Saúde | ponto de atenção acionável; hoje não é limitado ao período |
| Follow-ups vencidos | pendente e `dueAt < now` | snapshot atual | Saúde/KPI | ponto de atenção e drill-down existente |
| Aguardando resposta | Lead distinto não terminal com tentativa nessa categoria | snapshot atual | Saúde | ponto de atenção acionável |
| Follow-ups residuais | Lead terminal com follow-up pendente | snapshot atual | Saúde | exceção acionável |
| Cobertura de evidências | tratativas com evidência disponível / tratativas elegíveis | eventos no período | Saúde | qualidade, não atenção salvo pendência obrigatória |
| Tentativas contato | tentativas com evidência disponível / tentativas elegíveis | eventos no período | Saúde | renomear para **Evidências nas tentativas** e mover a Qualidade dos registros |

### Divergência já comprovada: 5 trabalhados x 4 na coorte

Não é duplicidade de cálculo. No recorte autenticado de outubro de 2026:

- **Leads trabalhados = 5** conta Leads com evento operacional ocorrido no período, inclusive Leads recebidos antes dele.
- A antiga coorte mostra **Trabalhados = 4** porque parte exclusivamente dos Leads recebidos no período e aceita fatos até o fim do período.

Os dois números representam universos diferentes com nomes visualmente próximos. A nova tela não deve chamá-los de mesma etapa. A coorte/funil atual deve ser substituída por uma jornada explicitamente definida.

### Visão operacional atual

Campanhas e PDVs usam o mesmo escopo autorizado e filtram eventos por período, porém a coluna `Base` conta Leads existentes no escopo, sem recorte por `receivedAt`. Isso é válido como carteira/base atual, mas deve ser rotulado explicitamente para não parecer volume de entrada do período.

## Produtividade atual — métricas, fórmulas e limites

Os fatos de produtividade são atribuídos ao **vendedor executor** (`actorMembershipId`). A lista contém vendedores ativos e acessíveis no escopo; por isso os totais podem divergir do Dashboard se eventos foram feitos por outro perfil ou se houver eventos históricos de vendedor hoje inativo.

| Métrica atual | Fórmula/denominador | Universo | Limite atual |
| --- | --- | --- | --- |
| Vendedores visíveis | vendedores ativos com PDV acessível | snapshot | deve virar contexto, não KPI |
| Carteira | Leads atualmente atribuídos ao vendedor | snapshot | base para cobertura individual |
| Leads atribuídos no período | atribuições no período | evento no período | já calculado, não exibido |
| Leads trabalhados | Leads distintos com evento operacional cujo ator é o vendedor | eventos no período | manter |
| Leads com tentativa | Leads distintos com tentativa cujo ator é o vendedor | eventos no período | já calculado, não exibido na tabela desktop |
| Tentativas | tentativas cujo ator é o vendedor | eventos no período | manter |
| Contatos efetivos | tratativas efetivas cujo ator é o vendedor | eventos no período | volume de apoio |
| Taxa de contato | Leads distintos com contato / Leads trabalhados | eventos por ator no período | manter |
| Conversões | conversões cujo ator é o vendedor | eventos no período | atualmente sem taxa de conversão |
| 1ª tentativa / 1º contato | média dos primeiros fatos executados pelo vendedor - recebimento | eventos por ator no período | manter |
| Follow-ups criados/concluídos | `createdAt` / `completedAt` no período | evento no período | manter como disciplina |
| Follow-ups vencidos/pendentes | estado atual por proprietário | snapshot | manter atenção por vendedor |
| Taxa de follow-up | concluídos / (concluídos + pendentes) | mistura conclusão no período e pendência atual | exige revisão antes de permanecer |
| Leads sem trabalho | carteira atual sem primeiro fato | snapshot | pertence ao Dashboard como gargalo; na produtividade deve virar cobertura por vendedor |
| Governança | registros completos/pendentes | sem filtro de período | não é produtividade por si só |

### Divergência Dashboard x Produtividade observada

No mesmo recorte autenticado, Dashboard mostrou 9 tentativas e Produtividade 4. A causa é a dimensão de autoria: o Dashboard conta todas as tentativas em Leads autorizados; a Produtividade conta apenas tentativas executadas por vendedores ativos mostrados na equipe. O redesign deve preservar essa diferença e deixar a finalidade de cada tela explícita.

## Contrato proposto para o redesign

### Dashboard — detectar

1. Filtros compartilhados.
2. Resumo da operação: Recebidos; Cobertura de trabalho (`trabalhados / recebidos elegíveis`, acompanhado de `X de Y`); Taxa de contato; Taxa de conversão; tempos até primeiro fato.
3. Pontos de atenção: somente exceções acionáveis, com drill-down para a fonte correspondente.
4. Jornada da Base: Recebidos → Trabalhados → Contato efetivo → Convertidos, com percentual da transição anterior; tentativas e Leads com tentativa como esforço complementar.
5. Visão operacional por Campanha/PDV: onde o problema se concentra, sem ranking de vendedor.
6. Qualidade dos registros: evidências somente quando houver leitura acionável; evidência opcional ausente não é pendência.

### Produtividade — diagnosticar

1. Filtros compartilhados e quantidade discreta de vendedores no escopo.
2. Resumo da execução: Trabalhados, Tentativas, Taxa de contato, Taxa de conversão, tempo até 1ª tentativa e Follow-ups vencidos.
3. Desempenho por vendedor: barras horizontais e seletor de indicador; uma métrica por vez, nunca barras empilhadas de fatos não aditivos.
4. Evolução da produtividade: fatos diários para identificar constância. Taxas diárias só aparecem se calculadas sobre denominadores do próprio dia.
5. Equipe no período: tabela ordenável, com coluna de cobertura, alcance, esforço, eficiência, resultado, tempo e disciplina.
6. Detalhe do vendedor: drawer com diagnóstico, evolução e links para Leads/Follow-ups preservando filtros.

## Decisões ainda dependentes de produto após a auditoria

1. **Cobertura de trabalho no Dashboard:** o denominador recomendado é Leads recebidos no período e elegíveis no escopo. É necessário confirmar se Leads sem responsável devem fazer parte do denominador — a recomendação é **sim**, para não esconder a fila sem dono.
2. **Taxa de conversão por vendedor:** a semântica recomendada é Leads convertidos pelo vendedor / Leads com contato efetivo pelo vendedor. O serviço atual entrega apenas contagem de eventos de conversão; precisará expor Leads distintos para a taxa.
3. **Evolução diária:** recomenda-se começar por fatos absolutos (trabalhados, Leads com tentativa, tentativas, contatos, conversões e follow-ups concluídos). Taxas só entram quando a série diária usar denominadores diários explícitos.
4. **Taxa de follow-up:** a fórmula atual mistura eventos de conclusão no período com estoque pendente. Não deve ser promovida até receber nova definição de produto.

## Arquivos auditados

- `client/src/pages/V2Dashboard.tsx`
- `client/src/pages/V2Productivity.tsx`
- `client/src/components/v2/AnalyticsFilters.tsx`
- `client/src/index.css`
- `server/v2/analyticsService.ts`
- `server/v2/analyticsDomain.ts`
- `server/v2/analyticsScopePolicy.ts`
- `server/v2/pdvScope.ts`
- `server/v2/access.ts`
- `server/v2/router.ts`
