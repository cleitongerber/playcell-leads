# Playcell Leads — Pacote de transferência para outra IA

## 1. Objetivo deste pacote

Este projeto é um sistema interno de gestão e ativação de leads para a Rede Playcell. Ele foi criado para três lojas em área de Fibra:

- Videira: 3 vendedores.
- Fraiburgo: 2 vendedores.
- Caçador: 3 vendedores.

A rotina comercial considerada é de terça a quinta-feira, com referência de 20 disparos por vendedor por dia.

O sistema permite importar a base de leads, distribuir a carteira por loja, permitir que o vendedor assuma o lead, registrar contato por WhatsApp ou telefone, atualizar o status do atendimento e acompanhar produtividade por vendedor e por loja.

Este arquivo deve ser lido antes de modificar o código. O código completo está na mesma pasta deste documento.

## 2. Estado atual

O MVP implementado possui:

1. Autenticação individual usando o fluxo OAuth já configurado no template do projeto.
2. Perfil de administrador e perfil de vendedor.
3. Importação de arquivos CSV, XLS e XLSX.
4. Reconhecimento das colunas principais de nome, telefone, e-mail, loja, segmento, prioridade e origem.
5. Preservação de **todas as colunas originais** da planilha em `leads.extraData`.
6. Reimportação por telefone: se o telefone já existir, o lead é atualizado em vez de duplicado.
7. Carteirização: o vendedor assume o lead e ele permanece vinculado ao vendedor até a finalização.
8. Abertura do WhatsApp com mensagem inicial e abertura do telefone para ligação.
9. Registro de canal, status, observação, follow-up e histórico do atendimento.
10. Dashboard administrativo com visão geral dos leads.
11. Tela administrativa para vincular cada usuário a Videira, Fraiburgo ou Caçador.
12. Relatório de produtividade por vendedor e por loja.
13. Exportação do relatório de produtividade para CSV.
14. Testes automatizados, checagem TypeScript e build de produção executados com sucesso.

## 3. Stack técnica

- React 19 + TypeScript.
- Vite.
- Tailwind CSS 4.
- Express.
- tRPC 11.
- Drizzle ORM.
- MySQL ou TiDB.
- Manus OAuth para autenticação no ambiente original.
- `xlsx` para leitura e geração de CSV/XLS/XLSX no navegador.
- Vitest para testes.
- `lucide-react` para ícones.

O projeto usa o padrão tRPC-first. As chamadas da interface devem continuar utilizando `trpc.*.useQuery` e `trpc.*.useMutation`. Não criar endpoints REST paralelos sem necessidade.

## 4. Estrutura dos arquivos mais importantes

```text
client/src/App.tsx                         Rotas principais.
client/src/components/DashboardLayout.tsx Layout lateral e autenticação.
client/src/pages/Home.tsx                  Dashboard geral.
client/src/pages/Leads.tsx                 Fila e ficha de atendimento.
client/src/pages/ImportLeads.tsx           Importação CSV/XLS/XLSX.
client/src/pages/Team.tsx                  Vínculo de usuários aos PDVs.
client/src/pages/Reports.tsx               Relatório de produtividade.
client/src/index.css                       Tema visual.
drizzle/schema.ts                           Schema das tabelas.
drizzle/0000_parched_kylun.sql              Migração inicial.
drizzle/0001_even_mariko_yashida.sql        Tabelas de leads e histórico.
drizzle/0002_greedy_firestar.sql            Coluna extraData.
server/db.ts                                Consultas e regras de negócio do banco.
server/routers.ts                            Contratos tRPC e autorização.
server/auth.logout.test.ts                   Teste do logout.
server/leads.validation.test.ts              Testes de validação dos procedimentos.
package.json                                Scripts e dependências.
```

Não editar `server/_core` sem necessidade. Ele contém a infraestrutura do template, incluindo autenticação, contexto, servidor Express e integração com Vite.

## 5. Modelo de dados

### `users`

Tabela base de autenticação. Possui `role`, que pode ser `admin` ou `user`.

### `seller_profiles`

Relaciona o usuário a uma loja:

- `userId`.
- `store`: `Videira`, `Fraiburgo` ou `Caçador`.
- `displayName`: nome que aparece na carteira.

### `leads`

Campos principais:

- `name`.
- `phone`.
- `email`.
- `store`.
- `segment`.
- `priority`.
- `source`.
- `status`.
- `assignedTo`.
- `assignedAt`.
- `lastContactAt`.
- `nextFollowUpAt`.
- `lastContactChannel`.
- `lastNote`.
- `extraData`: texto JSON com todas as colunas originais da planilha.
- `createdAt` e `updatedAt`.

### `lead_activities`

Histórico de ações do lead:

- Assunção.
- Contato.
- Alteração de status.
- Observação.
- Canal utilizado.
- Usuário responsável.
- Data e hora.

### `lead_imports`

Registra o nome do arquivo, o usuário que fez a importação, a quantidade de linhas e a data.

## 6. Status disponíveis

Os status atuais são:

- `new`: Novo.
- `assigned`: Assumido.
- `contacted`: Contatado.
- `no_answer`: Sem resposta.
- `interested`: Interessado.
- `proposal`: Proposta.
- `scheduled`: Agendado.
- `converted`: Convertido.
- `not_interested`: Sem interesse.
- `invalid`: Número inválido.
- `callback`: Retorno futuro.

Ao clicar em WhatsApp ou telefone, o sistema registra automaticamente o contato e atualiza o lead para `contacted`. O usuário ainda pode alterar o status manualmente na ficha.

## 7. Regra de visibilidade e carteirização

- Administradores visualizam todos os leads.
- Vendedores visualizam os leads já atribuídos a eles.
- Vendedores também visualizam leads novos e não atribuídos da loja à qual estão vinculados.
- Um lead assumido por um vendedor fica reservado para ele.
- Outro vendedor não deve assumir o mesmo lead.
- O administrador pode visualizar o conjunto completo e realizar ações administrativas.

Antes de colocar em produção, validar se a política desejada permite que vendedores visualizem todos os leads disponíveis do próprio PDV ou se cada lead deve ser distribuído individualmente pelo gerente.

## 8. Importação da planilha

A importação exige, no mínimo:

- Uma coluna reconhecível como nome, nome do cliente ou cliente.
- Uma coluna reconhecível como telefone, celular, WhatsApp ou phone.

A loja pode ser informada por coluna `loja`, `store` ou `PDV`. Se não existir, o sistema utiliza a loja padrão escolhida na tela.

O sistema guarda as colunas originais em JSON no campo `extraData`. Dessa forma, campos como CPF, cidade, plano atual, consumo, endereço, elegibilidade, data de renovação, observações e quaisquer outras colunas podem ser preservados sem alterar o schema a cada nova planilha.

A atualização de uma planilha existente usa o telefone como chave de reimportação. É recomendável normalizar telefones antes de importar para reduzir casos de duplicidade causados por máscaras ou códigos de país diferentes.

## 9. Relatório de produtividade

O relatório administrativo calcula, por vendedor e loja:

- Quantidade de leads na carteira.
- Contatos realizados.
- Agendamentos.
- Convertidos.
- Leads sem resposta.
- Taxa de conversão.

Os contatos são contabilizados quando existe `lastContactAt`, preenchido pelos botões de WhatsApp/telefone ou por uma ação de contato registrada.

A tela também possui exportação para CSV. Próximas evoluções recomendadas:

- Filtro por período.
- Filtro por loja.
- Filtro por segmento.
- Indicador de disparos realizados por dia.
- Tempo entre assunção e primeiro contato.
- Comparativo com a meta de 20 disparos por dia.
- Ranking semanal e mensal.
- Histórico de alterações de status.

## 10. Comandos locais

Na raiz do projeto:

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm dev
```

Para gerar uma migração depois de alterar `drizzle/schema.ts`:

```bash
pnpm drizzle-kit generate
```

Depois de revisar o SQL gerado, aplicar a migração no banco configurado. O script `db:push` também existe, mas mudanças de produção devem ser revisadas antes de aplicar.

## 11. Variáveis de ambiente

Não compartilhar valores secretos. Configurar no ambiente de publicação:

```text
DATABASE_URL
JWT_SECRET
VITE_APP_ID
OAUTH_SERVER_URL
VITE_OAUTH_PORTAL_URL
OWNER_OPEN_ID
OWNER_NAME
BUILT_IN_FORGE_API_URL
BUILT_IN_FORGE_API_KEY
VITE_FRONTEND_FORGE_API_URL
VITE_FRONTEND_FORGE_API_KEY
```

`DATABASE_URL` deve apontar para MySQL ou TiDB. `JWT_SECRET` deve ser um valor forte e exclusivo. As variáveis relacionadas ao OAuth precisam ser ajustadas conforme o provedor de autenticação utilizado no novo ambiente.

Nunca colocar `.env`, tokens, senhas ou chaves privadas dentro do ZIP compartilhado.

## 12. Publicação online com banco de dados

A publicação precisa incluir:

1. Um serviço Node.js capaz de executar `pnpm build` e `pnpm start`.
2. Um banco MySQL ou TiDB persistente.
3. Variáveis de ambiente configuradas no serviço.
4. Migrações executadas na ordem `0000`, `0001` e `0002`.
5. URL de callback do OAuth cadastrada no provedor.
6. Domínio HTTPS.
7. Rotina de backup do banco.
8. Política de acesso aos dados de clientes.

A versão original foi criada em um ambiente WebDev com servidor Node, banco e OAuth integrados. Em outra plataforma, preservar a mesma separação entre frontend e backend ou utilizar o próprio processo Express para servir o build de Vite.

## 13. Cuidados de segurança e LGPD

- Restringir importação, relatório e equipe ao papel `admin`.
- Restringir os leads de vendedor à própria carteira e loja.
- Usar HTTPS em produção.
- Não registrar telefones completos em logs.
- Criar rotina de backup e restauração.
- Definir prazo de retenção para leads inativos.
- Validar os canais e as autorizações necessárias para contato comercial.
- Evitar exportações abertas sem registro de quem baixou o arquivo.
- Considerar auditoria para alterações de status, assunção e reatribuição.

## 14. Melhorias prioritárias para a próxima versão

### Prioridade alta

1. Filtros de período no relatório de produtividade.
2. Relatório de disparos diários comparado à meta por vendedor.
3. Tela para o gerente distribuir ou reatribuir leads.
4. Importação com normalização de telefone e validação de duplicidade.
5. Paginação e busca eficiente para bases grandes.

### Prioridade média

1. Histórico visual completo dentro da ficha do lead.
2. Lembretes de follow-up vencidos.
3. Exportação de relatórios por loja, período e vendedor.
4. Ranking semanal com regras de incentivo.
5. Indicadores de tempo até o primeiro contato.

### Prioridade futura

1. Integração oficial com WhatsApp Business API.
2. Mensagens automáticas aprovadas por segmento.
3. Permissões adicionais para gerente de loja.
4. Integração com CRM ou sistema de vendas.
5. Auditoria e trilha de alterações.

## 15. Prompt recomendado para outra IA

Use o texto abaixo junto com este código:

> Você recebeu o projeto Playcell Leads, um sistema interno de gestão de leads da Rede Playcell. Leia primeiro o arquivo `HANDOFF_PARA_OUTRA_IA.md` e depois inspecione o código.
>
> Preserve a arquitetura React + Vite + TypeScript + Tailwind + Express + tRPC + Drizzle. Não remova o fluxo de autenticação existente. Não altere o banco sem gerar, revisar e aplicar uma migração.
>
> O sistema atende três lojas com Fibra: Videira, Fraiburgo e Caçador. Usuários administradores podem importar CSV/XLS/XLSX, configurar vendedores e lojas, acompanhar o dashboard e acessar o relatório de produtividade. Vendedores devem tratar apenas os leads liberados para sua loja ou já carteirizados para eles.
>
> Todas as colunas originais da planilha devem continuar preservadas em `leads.extraData`. A reimportação usa telefone como chave e deve atualizar o lead existente sem duplicar a base.
>
> Antes de publicar, execute `pnpm install`, `pnpm check`, `pnpm test` e `pnpm build`. Configure um banco MySQL/TiDB, as variáveis de ambiente, as migrações e o callback do OAuth. Não exponha segredos no código.
>
> Para cada melhoria, explique o impacto no schema, gere a migração, escreva ou atualize testes, valide a interface e só então publique.

## 16. Critério de aceite da próxima IA

A próxima versão só deve ser considerada pronta quando:

- O login funcionar para administrador e vendedor.
- O administrador conseguir importar a planilha sem perder nenhuma coluna.
- A reimportação não criar duplicidades pelo telefone.
- O vendedor conseguir assumir, contatar e finalizar o lead.
- O lead permanecer na carteira correta.
- O administrador conseguir filtrar e exportar o relatório.
- Os dados persistirem após reiniciar o servidor.
- `pnpm check`, `pnpm test` e `pnpm build` passarem.
- O banco estiver configurado com backup e acesso protegido.
