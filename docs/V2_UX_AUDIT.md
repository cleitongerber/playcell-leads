# Auditoria UX/UI — Playcell Leads V2

Data: 25/09/2026

## Escopo auditado

- Rotas V2 em `client/src/App.tsx`;
- páginas operacionais, gerenciais e administrativas V2;
- filtros analíticos, tabelas, formulários, diálogos e estados de consulta;
- manifesto, service worker e instalação PWA;
- tokens globais e componentes UI existentes.

## Mapa de rotas V2

| Rota | Área |
| --- | --- |
| `/v2/dashboard` | Dashboard operacional |
| `/v2/leads` e `/v2/leads/:id` | Fila, carteira e detalhe do Lead |
| `/v2/follow-ups` | Central de follow-ups |
| `/v2/campaigns` e `/v2/campaigns/:id` | Campanhas e gestão da base |
| `/v2/campaigns/:id/imports` | Importador configurável |
| `/v2/productivity` | Produtividade |
| `/v2/reports` | Relatórios e exportação |
| `/v2/admin` | PDVs, usuários e PartnerContext |
| `/v2/governance` | Governança |
| `/v2/import-settings` | Configuração de importações |

## Achados e prioridade

### P0 — bloqueia ou fragiliza uso

1. As rotas V2 não têm AppShell compartilhado. Cada página recria cabeçalho,
   atalhos e espaçamento, o que deixa navegação, contexto de parceiro e sessão
   inconsistentes.
2. O service worker usa `skipWaiting()` automaticamente. Uma versão nova pode
   assumir a página em uso sem uma atualização explícita e sem feedback.
3. O meta viewport bloqueia zoom do navegador por `maximum-scale=1`, prejudicando
   acessibilidade e uso em telas pequenas.

### P1 — prejudica muito a experiência

1. Tabelas de Dashboard, Produtividade, Relatórios, importador e gestão de base
   dependem de largura mínima e overflow horizontal no mobile.
2. Ações de navegação aparecem repetidas em cabeçalhos de página, enquanto não
   há navegação principal V2 persistente.
3. O detalhe do Lead apresenta tratativa, timeline, follow-ups e evidências em
   uma sequência longa com pouca hierarquia para o uso diário.
4. Filtros variam entre telas e não evidenciam quantos critérios estão ativos.
5. Loading e estados vazios dependem sobretudo de texto; faltam skeletons e
   mensagens acionáveis consistentes.

### P2 — inconsistências importantes

1. Há mistura de tamanhos, bordas, padding e rótulos de formulário entre as
   páginas V2.
2. Alguns campos dependem apenas de placeholder e alguns selects nativos têm
   aparência divergente.
3. O importador já é um fluxo por etapas, mas seu progresso não diferencia
   claramente etapa concluída, atual e pendente.
4. O PWA possui manifesto e ícones SVG, mas não comunica disponibilidade de
   atualização nem estado offline.

### P3 — refinamentos

1. Melhorar foco visível, alvos de toque e descrições de ações.
2. Reduzir refetch desnecessário de queries de leitura.
3. Uniformizar estados de erro sem expor detalhes técnicos.

## Plano aplicado

1. Criar AppShell V2 com autenticação, PartnerContext, navegação por papel,
   sidebar desktop e navegação inferior mobile.
2. Criar primitives leves de página, feedback de query, tabelas/listas
   responsivas e filtros.
3. Refatorar as telas V2 mais frequentes: Dashboard, Leads, detalhe do Lead,
   Follow-ups, Campanhas/gestão da base, Importador, Produtividade e Relatórios.
4. Consolidar tokens e regras responsivas globais sem trocar biblioteca visual
   ou alterar APIs/regras de negócio.
5. Corrigir PWA com atualização explícita, cache somente de shell/assets
   públicos e aviso offline.
6. Validar em breakpoints de 360, 390, 430, 768, 1024, 1280 e 1440 px, além de
   testes, build e smoke publicado.
