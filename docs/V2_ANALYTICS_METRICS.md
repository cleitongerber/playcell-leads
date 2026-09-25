# Métricas analíticas V2

Todas as consultas analíticas usam `partner_settings.timezone` no backend. Os
intervalos são `[início, fim)`, evitando dupla contagem entre períodos.

- **Leads recebidos:** `leads.receivedAt` no período.
- **Disponíveis:** snapshot de Leads sem `assignedMembershipId`, status
  `open`/`in_progress`, campanha ativa e não congelada, PDV ativo e vínculo
  campanha/PDV ativo.
- **Em carteira:** snapshot de Leads atribuídos com status `open` ou
  `in_progress`.
- **Tratados:** Leads distintos com `lead_contacts.occurredAt` no período.
  Status não conta como tratativa.
- **Concluídos:** Leads distintos com evento `status_changed` no período para
  um `lead_status` terminal.
- **Convertidos:** subconjunto de concluídos cujo status terminal pertence à
  categoria `completed`. Estados de perda devem usar `discarded`.
- **Conclusão no relatório de Leads:** o estado atual vem de `leads.statusId`;
  a data de conclusão vem do último evento `status_changed` que alcançou um
  status terminal, sem inferir a data a partir do status atual.
- **Primeiro contato:** `leads.firstContactAt`, preenchido pelo primeiro
  contato real. Tempo médio é `firstContactAt - receivedAt`; sem contato não é
  contabilizado como zero.
- **Follow-up vencido:** `follow_ups.status = pending` e `dueAt < agora`.
  Vencimento nunca é persistido como status.
- **Taxa de conversão do Dashboard:** Leads da coorte recebida no período que
  alcançaram conversão até o fim do período ÷ Leads recebidos no período.
- **Taxa de tratamento da Produtividade:** Leads distintos tratados pelo
  vendedor no período ÷ Leads atualmente atribuídos ao vendedor cuja última
  atribuição ocorreu no período.
- **Taxa de conclusão de follow-up:** Follow-ups concluídos no período ÷
  (concluídos no período + pendentes com vencimento até o fim do período).
  Cancelados não entram no denominador.

Indicadores de estoque (disponíveis, carteira, follow-ups vencidos e saúde)
respondem à posição atual; filtros de campanha, PDV e vendedor continuam
valendo, mas um período não transforma um snapshot em histórico inexistente.

Comparações usam o intervalo anterior com a mesma duração exata. Quando o
denominador é zero, a interface exibe `—` e não uma tendência artificial.

## Escopo e privacidade

O SQL sempre recebe `partnerId` e, quando aplicável, PDVs do Manager ou a
membership do Seller. Exportações reutilizam a mesma consulta paginada do
relatório, sem URLs assinadas, `storageKey`, tokens ou secrets. Cada
exportação grava somente filtros resumidos, tipo e quantidade em `audit_logs`.
