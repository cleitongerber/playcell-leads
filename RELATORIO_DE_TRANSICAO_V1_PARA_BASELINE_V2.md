# RELATÓRIO — TRANSIÇÃO DA V1 PARA BASELINE V2

Data: 23/09/2026
Status: planejamento sem alterações. Nenhuma migration, deploy, conexão de escrita, modificação de configuração ou alteração de dados foi executada.

## 1. Estado de produção confirmado

| Item | Estado |
|---|---|
| Serviço | Render Web Service `playcell-leads` (`srv-dancvejtqb8s73bg8q4g`) |
| Repositório/branch | `cleitongerber/playcell-leads` / `main` |
| Commit publicado | `d878309b591dd837c429ddf29ba09805d185de82` |
| Provedor/engine | TiDB Cloud / TiDB compatível com MySQL |
| Configuração de banco | `DATABASE_URL` e `APP_DATABASE` estão configuradas no Render; valores não foram abertos nem copiados |
| CODEX 002 | Alterações locais, ainda fora de produção |

## 2. Método de backup disponível

Pela documentação vigente do TiDB Cloud, uma instância TiDB Cloud Starter gratuita recebe snapshot automático diário, com retenção de **um dia**. Não há backup manual para Starter/Essential. O snapshot pode ser restaurado para uma nova instância; credenciais e permissões SQL não são copiadas para o destino.

Isso é um ponto de recuperação restaurável, mas não substitui a confirmação operacional de que há um snapshot concluído e visível no console antes de uma alteração de schema.

### Ação manual obrigatória antes de continuar

O proprietário da conta TiDB Cloud deve:

1. Abrir **My TiDB → instância de produção → Data → Backup**.
2. Confirmar que existe pelo menos um snapshot com estado concluído, data/hora recente e opção de **Restore** para nova instância.
3. Registrar externamente (fora deste repositório) o horário do snapshot e o identificador não sensível da instância.
4. Não iniciar restore, branch, backup manual, alteração de plano ou mudança de variável nesta etapa.

Se não houver snapshot restaurável, a transição fica bloqueada. Como o plano gratuito mantém apenas um dia, a janela de execução posterior deve ser planejada dentro da retenção e com o snapshot já confirmado.

## 3. Inventário do banco real

**Pendente de backup confirmado e de acesso somente leitura.**

Após a confirmação acima, o inventário deverá ser executado por SQL Editor do TiDB Cloud ou credencial `Database Read-Only`, contendo apenas:

- `SHOW TABLES` e `SHOW CREATE TABLE` das estruturas relevantes;
- `information_schema.columns` e `information_schema.statistics`;
- estrutura e conteúdo técnico de `__drizzle_migrations`;
- contagens agregadas de `users`, `pdvs`, `campaigns`, `leads`, `lead_activities`, `follow_ups`, `lead_imports` e estruturas legadas;
- nenhum nome, telefone, e-mail, documento ou outro dado pessoal.

O inventário alimentará o relatório de reconciliação e será congelado como evidência de pré-transição.

## 4. Proposta definitiva de baseline V2

### Decisão

A V2 **não deve reaplicar a cadeia histórica V1** no banco preservado. O histórico V1 será mantido somente como evidência/auditoria. A evolução V2 deve começar a partir de uma representação canônica do schema real, validada pelo inventário.

### Baseline proposto

1. Após confirmar backup e inventariar o banco real, gerar uma representação canônica do schema existente (tabelas, colunas, enums, índices e ledger) em ambiente local controlado.
2. Criar uma nova linhagem de migrations V2, separada da pasta histórica V1, por exemplo `drizzle-v2/`, com metadata/snapshot gerados pelo Drizzle Kit a partir desse schema canônico. Não editar snapshots JSON manualmente.
3. A primeira entrada dessa linhagem será um marcador de baseline V2 **sem DDL de aplicação**: ela não cria tabela, não recria índice e não move dados. Seu único efeito futuro permitido será o registro normal no ledger Drizzle, após validação da igualdade entre banco e baseline.
4. Configurar o projeto para que somente a nova linhagem seja usada para migrations futuras, preservando os SQL V1 em diretório histórico somente leitura.
5. Em um banco restaurado a partir do snapshot, validar: schema preservado → marcador baseline V2 → migration incremental de teste → nenhuma estrutura V1 recriada ou removida.

Essa estratégia não mascara divergências: qualquer diferença descoberta no inventário deve virar uma decisão explícita de compatibilidade antes do marker. Não haverá `CREATE TABLE IF NOT EXISTS` nem migration de “conserto geral” contra a produção.

## 5. Tratamento do histórico V1

- `0000` a `0006` e seus snapshots/journal permanecem preservados como histórico técnico.
- Eles não serão usados para reconstruir a produção existente nem serão executados como parte da transição V2.
- A divergência conhecida de `0000`, o journal historicamente incompleto e os dois arquivos `0004_*` ficam documentados no relatório de reconciliação, sem tentativa de reescrever o passado.
- O ledger atual será apenas inventariado. Qualquer marcação de baseline V2 ocorrerá somente após backup confirmado e teste em cópia restaurada.

## 6. Estruturas legadas

| Estrutura | Situação | Decisão V2 nesta etapa |
|---|---|---|
| `maintenance_jobs` | Criada pelo antigo bootstrap; sem migration correspondente e sem uso atual | **Manter temporariamente** e incluir no inventário. Não recriar, não usar para V2 e não remover agora. |
| `seller_profiles` | Projeção legada de PDV único, enquanto `user_pdvs` já admite vários PDVs | **Manter temporariamente** para compatibilidade V1; avaliar substituição após a camada multi-parceiro estar estável. |
| `store` textual em `leads` | Campo legado coexistindo com `pdvId` | **Manter temporariamente**; V2 deverá tratar `pdvId` como relação operacional. |

`maintenance_jobs` poderá ser aposentada somente numa migration posterior, após comprovar que não possui uso operacional, garantir backup e definir retenção do seu conteúdo. Não haverá `DROP` durante a baseline.

## 7. Plano da primeira migration estrutural V2 — multi-parceiro

Esta migration **não será implementada nesta etapa**. O plano é:

1. Criar `partners` e `partner_settings`.
2. Criar um único registro inicial, **Parceiro Legado**, como proprietário de todos os dados V1.
3. Criar `user_partners` para associar os usuários existentes ao Parceiro Legado, preservando perfis e acessos atuais.
4. Adicionar inicialmente `partnerId` de forma compatível às entidades operacionais: `pdvs`, `campaigns`, `leads`, `lead_activities`, `lead_imports`, `follow_ups`, `audit_logs`, `notifications`, `password_reset_requests` e, enquanto existir, `seller_profiles`.
5. Associar registros existentes ao Parceiro Legado, validar que não há linhas sem parceiro e só então tornar os campos obrigatórios quando o inventário confirmar compatibilidade.
6. Adicionar índices compostos que iniciem por `partnerId` para as consultas de escopo, incluindo pelo menos leads por parceiro/PDV/responsável/status, campanhas por parceiro e associações de usuário/PDV por parceiro.
7. Revisar tabelas de associação (`user_pdvs` e `campaign_pdvs`) para garantir que não permitam ligação entre registros de parceiros distintos. A decisão de coluna direta versus validação por relações será tomada após o inventário real.

Os usuários permanecem globais e serão relacionados a parceiros por `user_partners`; não é recomendado adicionar um único `partnerId` obrigatório em `users`, pois o objetivo V2 é permitir acesso a mais de um parceiro.

## 8. Riscos restantes

- O tipo exato da instância TiDB Cloud ainda precisa ser confirmado no console; isso define branch, SQL Editor e recursos de restore.
- A retenção de backup gratuita é de um dia, reduzindo a margem para rollback.
- Ainda não há inventário do schema real nem do `__drizzle_migrations`.
- A criação do marker baseline V2 requer validação em uma instância restaurada, mesmo que seja temporária e dentro da franquia gratuita.
- A primeira migration multi-parceiro exigirá atualização de dados existente para o Parceiro Legado; ela deve ser transacional/reexecutável quando o TiDB permitir e validada por contagens antes/depois.

## 9. Decisão

**Ainda bloqueado para iniciar a implementação V2.**

O bloqueio é intencional e técnico: falta a confirmação manual de backup restaurável e o inventário somente leitura do banco real. Após essas duas evidências, será possível congelar o schema canônico, criar a baseline V2 segura e iniciar a implementação da primeira migration multi-parceiro sem risco de reaplicar a história V1 sobre dados existentes.
