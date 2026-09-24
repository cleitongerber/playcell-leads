# PLANO DE FUNDAÇÃO TÉCNICA V2.0

Data: 23/09/2026
Estado: proposta técnica. Não autoriza reset, deploy, alteração de variável, execução de migration ou qualquer comando destrutivo.

## 1. Decisão arquitetural

A V2 nascerá em um **novo banco lógico vazio no mesmo cluster TiDB Cloud**, por exemplo `playcell_leads_v2` (nome final a confirmar antes do corte). Essa decisão é preferível a apagar imediatamente o banco V1 porque:

- cria um schema e um ledger `__drizzle_migrations` limpos, sem herdar a inconsistência V1;
- não exige uma segunda infraestrutura paga: é apenas outro database no mesmo cluster;
- permite rollback rápido para o banco e commit V1 enquanto a V2 é validada;
- preserva o código aproveitável como referência, mas elimina a dependência de `schemaBootstrap` e das migrations V1;
- autoriza a eliminação posterior do banco V1 somente após estabilização explícita da V2.

O banco V1, seus dados e seu ledger não serão reconciliados nem usados como origem de migrations V2. Os relatórios de auditoria permanecem no repositório como histórico técnico.

## 2. Modelo de tenancy e RBAC

### Princípios

- `users` representa a identidade global de login, sem um único `partnerId` obrigatório.
- `user_partners` é a associação de acesso e função de uma identidade a um parceiro.
- Todas as entidades comerciais e operacionais possuem `partnerId` obrigatório desde a criação.
- O backend constrói um `PartnerContext` a partir da sessão, parceiro ativo e membership; frontend nunca é fonte de autorização.
- Toda leitura e mutação exige `partnerId` do contexto no predicado SQL, além do ID do registro. Nunca basta buscar por `id` isolado.

### Papéis

| Papel | Escopo | Capacidades principais |
|---|---|---|
| `super_admin` | Global | Criar/ativar parceiros, gerenciar acesso global, auditoria global e suporte controlado. |
| `partner_admin` | Um parceiro | Usuários do parceiro, PDVs, campanhas, configurações, importação e relatórios do parceiro. |
| `manager` | Um parceiro, PDVs autorizados | Gestão de PDVs/vendedores, dashboards, pendências e histórico dentro do escopo permitido. |
| `seller` | Um parceiro, PDVs autorizados | Fila, carteira própria, tratativas, follow-ups e indicadores próprios. |

`super_admin` será atributo de identidade global em `users`. Os demais papéis existirão em `user_partners`, permitindo que o mesmo usuário tenha funções distintas em parceiros diferentes.

## 3. Schema V2 proposto

### Identidade, parceiros e configurações

| Entidade | Campos essenciais | Relações e regras |
|---|---|---|
| `users` | `id`, `email`, `passwordHash`, `name`, `isActive`, `systemRole`, `lastSignedInAt`, timestamps | Identidade única; `email` único; `systemRole` contém `super_admin` ou `none`. |
| `partners` | `id`, `code`, `name`, `isActive`, timestamps | `code` único; proprietário dos dados comerciais. |
| `partner_settings` | `id`, `partnerId`, `timezone`, SLA de assunção/primeiro contato/parado, configurações de notificação, timestamps | `partnerId` único; valores padrão criados com o parceiro. |
| `user_partners` | `id`, `userId`, `partnerId`, `role`, `isActive`, timestamps | unique (`userId`, `partnerId`); única fonte para acesso partner-scoped. |

### PDVs, campanhas e configuração de importação

| Entidade | Campos essenciais | Relações e regras |
|---|---|---|
| `pdvs` | `id`, `partnerId`, `code`, `name`, `city`, `region`, `managerMembershipId`, `isActive`, metas, timestamps | unique (`partnerId`, `code`); um PDV pertence a um parceiro. |
| `user_pdv_assignments` | `id`, `partnerId`, `membershipId`, `pdvId`, `isActive` | unique (`membershipId`, `pdvId`); atribuição flexível de vendedores/gestores a vários PDVs. |
| `campaigns` | `id`, `partnerId`, `code`, `name`, `description`, `status`, `isFrozen`, timestamps | unique (`partnerId`, `code`); nunca hard-delete operacional. |
| `campaign_pdvs` | `id`, `partnerId`, `campaignId`, `pdvId` | unique (`campaignId`, `pdvId`); valida associação do mesmo parceiro. |
| `lead_statuses` | `id`, `partnerId`, `code`, `label`, `category`, `sortOrder`, `isTerminal`, `isActive` | unique (`partnerId`, `code`); status padrão semeados para cada parceiro. |
| `lead_sources` | `id`, `partnerId`, `code`, `name`, `isActive` | Fonte configurável por parceiro. |
| `custom_field_definitions` | `id`, `partnerId`, `entityType`, `key`, `label`, `fieldType`, `optionsJson`, `isRequired`, `isActive`, `sortOrder` | unique (`partnerId`, `entityType`, `key`); campos customizados sem alterar schema por planilha. |
| `import_templates` | `id`, `partnerId`, `name`, `entityType`, `isActive`, timestamps | Define modelos reutilizáveis de importação. |
| `import_template_fields` | `id`, `templateId`, `targetField`, `sourceHeader`, `transform`, `isRequired`, `sortOrder` | Mapeamento configurável de cabeçalhos para campos padrão/customizados. |

### Leads e operação comercial

| Entidade | Campos essenciais | Relações e regras |
|---|---|---|
| `leads` | `id`, `partnerId`, `pdvId`, `campaignId`, `statusId`, `sourceId`, `assignedMembershipId`, dados de contato normalizados, `customData`, `receivedAt`, `assignedAt`, `firstContactAt`, `lastActivityAt`, `nextFollowUpAt`, `deletedAt` | O lead sempre pertence a um parceiro; exclusividade por update condicional `assignedMembershipId IS NULL`; soft delete. |
| `lead_timeline_events` | `id`, `partnerId`, `leadId`, `actorMembershipId`, `type`, `occurredAt`, `payloadJson`, `visibility` | Timeline imutável: criação, assunção, status, contato, nota, follow-up, agendamento, conversão e troca de responsável. |
| `lead_contacts` | `id`, `partnerId`, `leadId`, `membershipId`, `channel`, `outcome`, `contactedAt`, `summary` | Registro estruturado de cada contato; gera evento na timeline. |
| `follow_ups` | `id`, `partnerId`, `leadId`, `ownerMembershipId`, `dueAt`, `status`, `completedAt`, `note`, timestamps | Pendente, concluído, cancelado ou vencido; gera evento. |
| `appointments` | `id`, `partnerId`, `leadId`, `ownerMembershipId`, `scheduledAt`, `status`, `note`, timestamps | Agenda comercial explícita; gera evento. |
| `lead_evidences` | `id`, `partnerId`, `leadId`, `timelineEventId`, `uploadedByMembershipId`, `storageProvider`, `storageKey`, `fileName`, `mimeType`, `sizeBytes`, `checksum`, timestamps | Metadados de evidência; arquivo fora do banco; acesso sempre partner-scoped. |

### Governança, notificações e importações

| Entidade | Campos essenciais | Relações e regras |
|---|---|---|
| `lead_import_batches` | `id`, `partnerId`, `campaignId`, `pdvId`, `templateId`, `importedByMembershipId`, arquivo/metadados, totais processado/inserido/duplicado/inválido, timestamps | Auditoria da importação; não armazena planilha em dados pessoais sem política de retenção. |
| `lead_import_issues` | `id`, `partnerId`, `batchId`, `rowNumber`, `issueCode`, `field`, `detailsJson` | Erros sem expor conteúdo sensível desnecessário. |
| `notifications` | `id`, `partnerId`, `recipientMembershipId`, `type`, `title`, `body`, `readAt`, timestamps | Preparada para in-app, e-mail/push/WhatsApp por adaptador futuro. |
| `audit_logs` | `id`, `partnerId` anulável, `actorUserId`, `actorMembershipId`, `action`, `entityType`, `entityId`, `metadataJson`, `createdAt` | `partnerId` nulo apenas para ações globais de super admin. |
| `password_reset_requests` | `id`, `userId`, `partnerId` anulável, `requestedAt`, `resolvedAt`, `resolvedByUserId` | Mantém segurança de autenticação sem presumir parceiro no login. |

## 4. Relacionamentos principais

```text
User ──< UserPartner >── Partner ──< PartnerSettings
                              ├──< PDV ──< UserPdvAssignment >── UserPartner
                              ├──< Campaign ──< CampaignPdv >── PDV
                              ├──< LeadStatus / LeadSource / CustomFieldDefinition
                              └──< Lead ──< Timeline / Contact / FollowUp / Appointment / Evidence
                                           └──< ImportBatch / AuditLog / Notification
```

As referências possuem `partnerId` em ambas as pontas operacionais e são verificadas em transação. Dependendo do suporte validado no TiDB para as constraints compostas escolhidas, serão usadas chaves estrangeiras compostas ou validação transacional no repositório; em ambos os casos o predicado de parceiro no backend será obrigatório.

## 5. Índices e integridade

Índices mínimos de início:

- `user_partners (partnerId, userId)` unique e `(userId, isActive)`;
- `pdvs (partnerId, code)` unique e `(partnerId, isActive)`;
- `user_pdv_assignments (partnerId, membershipId, pdvId)` unique;
- `campaigns (partnerId, code)` unique, `(partnerId, isActive, isFrozen)`;
- `leads (partnerId, pdvId, assignedMembershipId, statusId, deletedAt)` para fila;
- `leads (partnerId, assignedMembershipId, updatedAt)` para carteira;
- `leads (partnerId, campaignId, receivedAt)` para dashboard/importação;
- `leads (partnerId, normalizedPhone)` para deduplicação configurável;
- `lead_timeline_events (partnerId, leadId, occurredAt)`;
- `follow_ups (partnerId, ownerMembershipId, status, dueAt)`;
- `lead_import_batches (partnerId, campaignId, createdAt)`;
- `audit_logs (partnerId, entityType, entityId, createdAt)` e `(actorUserId, createdAt)`.

Todas as consultas paginadas devem ordenar por chave estável e usar cursor/limite. Dashboards serão agregações filtradas obrigatoriamente por `partnerId`.

## 6. Timeline, follow-ups e evidências

### Timeline

`lead_timeline_events` é a fonte única e imutável de histórico. Serviços de domínio escrevem o evento e a alteração correspondente de lead na mesma transação. A interface apenas renderiza o evento; não constrói histórico pelo estado atual.

### Follow-up

Follow-up é entidade própria, vinculada ao responsável por membership e ao lead. A atualização de status (`pending`, `completed`, `cancelled`, `overdue`) atualiza a timeline e alimenta a central de pendências. Não será derivado apenas de `leads.nextFollowUpAt`.

### Evidências

Arquivos ficam no storage aprovado; o banco guarda metadados, checksum e chave opaca. Upload/download exige que lead, evidence e membership pertençam ao mesmo parceiro. Política de tamanho, MIME, retenção e antivírus será implementada antes de habilitar upload em produção.

## 7. Cadeia nova de migrations

Será criada uma nova pasta de saída, por exemplo `drizzle-v2/`, sem reutilizar `_journal.json` ou snapshots V1. A ordem proposta:

1. `0000_v2_foundation`: `users`, `partners`, `partner_settings`, `user_partners`, autenticação e auditoria global.
2. `0001_v2_partner_operations`: PDVs, associações a PDV, campanhas, status, fontes e custom fields.
3. `0002_v2_lead_lifecycle`: leads, timeline, contatos, follow-ups e agendamentos, incluindo índices de exclusividade e SLA.
4. `0003_v2_import_governance`: templates de importação, batches, issues, evidências, notificações e índices finais.
5. Próximas migrations somente incrementais, geradas/revisadas pelo Drizzle Kit e aplicadas por `drizzle-kit migrate`; `db:push` não será usado em produção.

Antes de execução, cada SQL será revisado contra banco V2 vazio e testado em local/ambiente descartável. O novo banco terá `__drizzle_migrations` criado e controlado somente por esta cadeia.

### Arquivamento V1

No momento da implementação, os SQL e metadata V1 serão movidos ou preservados em `drizzle-legacy-v1/` com um README que declare expressamente: histórico somente leitura, não executável pela configuração V2. Os relatórios de auditoria atuais permanecem intactos. `schemaBootstrap.ts` não será reintroduzido.

## 8. Procedimento exato para reset controlado — futuro, não executar agora

1. Aprovação explícita do plano e confirmação de snapshot TiDB Cloud restaurável.
2. Validar serviço, cluster, database-alvo e commit de produção; registrar somente identificadores não sensíveis.
3. Colocar a aplicação em janela de manutenção ou impedir novas escritas durante o corte.
4. Criar manualmente o novo database lógico V2 no cluster, confirmando que está vazio. Não executar `DROP`, `TRUNCATE` ou `DELETE` no banco V1.
5. Em estação administrativa confiável, apontar temporariamente o executor de migrations para o database V2 vazio e executar somente `drizzle-kit migrate` da cadeia V2 revisada.
6. Executar seed idempotente de primeiro Super Admin, parceiro inicial, configurações padrão, status e fontes padrão. Não usar senha em texto puro no seed.
7. Rodar testes de smoke, RBAC, isolamento tenant, importação, assunção concorrente e health check contra V2.
8. Alterar `APP_DATABASE` do serviço Render apenas no momento aprovado de cutover, para o nome do banco V2; fazer deploy explícito do commit V2.
9. Validar login, criação de parceiro, PDV, campanha, importação e isolamento. Manter V1 intacta durante a janela de rollback.
10. Só após período de estabilização e nova confirmação explícita avaliar apagar o database V1 e seus dados.

Rollback de cutover: retornar `APP_DATABASE` ao banco V1 e republicar o commit V1 `d878309...`. Isso não exige restaurar dados porque o banco V1 não foi modificado pelo procedimento.

## 9. Testes obrigatórios V2

- migrations V2 em banco vazio e reexecução sem efeitos inesperados;
- isolamento entre dois parceiros para todas as listagens, detalhes, dashboards, arquivos e exportações;
- tentativa de IDOR cruzado para lead, campanha, PDV, evidência, follow-up e importação;
- assunção concorrente do mesmo lead por memberships do mesmo parceiro;
- bloqueio de assunção e atualização por membership de parceiro/PDV diferente;
- papéis `super_admin`, `partner_admin`, `manager` e `seller`;
- timeline imutável e transação lead + evento;
- SLA e follow-ups vencidos/hoje/concluídos;
- importação com template, campo obrigatório, campo customizado, telefone duplicado e relatório;
- upload de evidência autorizado e rejeição de chave de outro parceiro;
- paginação/cursor, filtros e agregações com `partnerId` obrigatório;
- backup/rollback de cutover em ambiente restaurado antes de produção.

## 10. Riscos e pré-requisitos

- A instância TiDB Cloud e o snapshot restaurável precisam ser confirmados manualmente antes do corte.
- O plano gratuito possui retenção de backup curta; a janela de cutover deve respeitar esse limite.
- Criar novo database no cluster e alterar `APP_DATABASE` são ações externas e exigem aprovação manual no momento da execução.
- O histórico V1 deixa de ser mecanismo de setup; nenhum deploy V2 pode carregar ou executar a pasta legada.
- O serviço Render em plano Free pode hibernar; health checks e testes de cutover devem considerar tempo de ativação.

## 11. Sequência recomendada

1. Proprietário confirma snapshot restaurável.
2. Inventário somente leitura do banco V1 por SQL Editor/read-only.
3. Aprovação do schema V2 e dos nomes finais de database/partner inicial.
4. Implementação local do schema V2, migrations novas e camada de `PartnerContext`.
5. Testes completos em banco vazio descartável.
6. Revisão do reset controlado e aprovação de cutover.
7. Criação do database V2 vazio, migrations, seed e smoke tests.
8. Deploy explícito V2 e troca de `APP_DATABASE`.
9. Estabilização; aposentadoria V1 somente em decisão futura.

## Decisão

**Pronto para iniciar a implementação local da V2 após aprovação deste plano, mas não pronto para reset ou deploy.** O reset permanece bloqueado até confirmação manual de snapshot restaurável e aprovação explícita do procedimento de cutover.
