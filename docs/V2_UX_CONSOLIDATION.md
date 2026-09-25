# CODEX 014 — consolidação UX/UI V2

## Decisões

- Todas as rotas V2 passam por `V2AppShell`, que centraliza sessão, contexto de parceiro, navegação por perfil, seleção de tenant e logout.
- Desktop usa sidebar fixa a partir de 1024px; celular usa topbar, seletor de parceiro e bottom navigation com quatro destinos frequentes e `Mais` para as funções secundárias.
- Páginas V2 usam `v2-page`/`V2PageHeader`, tokens já existentes e estados compartilhados de loading/erro (`V2QueryState`).
- Tabelas analíticas e de gestão mantêm a tabela no desktop e oferecem cards/list rows no celular. Não há alteração nas consultas ou regras de autorização.
- Filtros analíticos têm labels, contador de filtros ativos e drawer no mobile; o backend continua sendo a autoridade de escopo e timezone.
- O service worker não assume controle silencioso de uma aba ativa. Atualizações são exibidas em aviso acionável; o cache não contém dados comerciais persistentes.
- O endpoint `auth.me` retorna somente campos de sessão necessários para a interface, sem `passwordHash` ou outros dados internos.

## Breakpoints validados por código

`<640px` (celular), `640–1023px` (tablet/notebook estreito) e `>=1024px` (sidebar desktop). A composição usa unidades fluidas e `env(safe-area-inset-*)`; não depende de modelos específicos de aparelho.

## Homologação visual

Executar em 360, 390, 430, 768, 1024, 1280 e 1440px, em zoom 100%:

1. Entrar e selecionar o parceiro.
2. Abrir Dashboard, ajustar filtros e navegar para Leads/Follow-ups.
3. Abrir um Lead, registrar tratativa e agendar follow-up.
4. Abrir Campanhas, gestão da base, distribuição e importação.
5. Abrir Produtividade e Relatórios; gerar CSV.
6. Abrir Administração/Governança com perfil autorizado.
7. Em mobile, conferir bottom navigation, `Mais`, drawer de filtros, cards de tabela e teclado aberto.
8. Instalar o PWA quando suportado; ao publicar nova versão, confirmar que o aviso de atualização aparece e a atualização ocorre somente após ação do usuário.
