# RELATÓRIO DE RECONCILIAÇÃO DE MIGRATIONS — PRÉ-V2

Data da auditoria: 23/09/2026
Escopo: somente leitura do repositório local. Nenhuma migration, DDL, DML ou alteração no banco foi executada.

## 1. Estado atual

O repositório contém oito arquivos SQL, de `0000_parched_kylun.sql` a `0006_campaign_freeze.sql`. O journal atual contém os oito tags na ordem esperada. A situação, porém, não pode ser considerada reconciliada até a comparação com o banco em uso:

- O arquivo original de `0000_parched_kylun.sql` não existe no histórico Git local. O arquivo atual foi restaurado a partir do snapshot `0001` e cria somente a tabela `users` no estado inicial.
- `0004_campaigns.sql`, `0005_password_reset_requests.sql` e `0006_campaign_freeze.sql` existiam como arquivos antes de serem incluídos no journal durante a estabilização V1.
- `maintenance_jobs` ainda é representada no schema Drizzle, mas não há migration que a crie. Ela era criada por `schemaBootstrap.ts`, hoje removido do startup.
- Não há `DATABASE_URL` nem `APP_DATABASE` configurados neste ambiente. Portanto, o schema real e `__drizzle_migrations` não foram consultados.

Consequentemente, qualquer classificação sobre o banco real permanece pendente de evidência. Não é seguro executar `drizzle-kit migrate`, `pnpm db:push` ou uma migration nova no banco atual.

## 2. Histórico encontrado

| Ordem | Arquivo | Papel esperado | SHA-256 para auditoria |
|---:|---|---|---|
| 0 | `0000_parched_kylun.sql` | Baseline inicial de `users` | `72b61b42937f93265688054e499f965e95a39843b80f7d77801c6b17fe0404d8` |
| 1 | `0001_even_mariko_yashida.sql` | Leads, atividades, importações e perfil de vendedor | `f7f4905ce62971c68206d484a6f4b89a3c2c937912431e2b0b66869bd18aad2d` |
| 2 | `0002_greedy_firestar.sql` | `leads.extraData` | `838017011e08022ce9a4fbc0e5292c71a77d42ce1d3184b9e642e4de1c7a9c43` |
| 3 | `0003_professional_leads.sql` | PDVs, escopos, SLA, follow-ups, auditoria e notificações | `61c704ccbf457040d3aaf99ca89c44a81bd2d4ff1bb557995b1d9fef379f9600` |
| 4 | `0004_campaigns.sql` | Campanhas, campanha × PDV e `leads.campaignId` | `d6891d6d55e8afc9b8e66c69c46d22fca9da4766f0c1339eb8f26f58c9eb3863` |
| 5 | `0004_local_auth.sql` | `users.passwordHash` | `d4a1f4848cc6776d7ba974582ec5984c984557299787622f86240b783347d822` |
| 6 | `0005_password_reset_requests.sql` | Solicitações de redefinição de senha | `b086d7b967bde394b5c7393b391536ab656197c113d82f6e4607b5554d7486ef` |
| 7 | `0006_campaign_freeze.sql` | `campaigns.isFrozen` | `4689ffb0161e319f992588ef621ba0c43e9a31a5fc2ec8d63fe72582e98aec17` |

Os SHA-256 acima servem para integridade desta auditoria; o hash gravado pelo Drizzle deve ser lido diretamente de `__drizzle_migrations` e não deve ser presumido igual sem confirmação.

Os snapshots `0001` e `0002` confirmam que, antes de `0001`, o schema conhecido já continha `users`; eles não preservam o SQL original de `0000`.

## 3. Matriz migration × schema × banco

Legenda para a coluna Banco real: A = registrada e existente; B = existente sem registro; C = registrada sem estrutura; D = divergente; E = legado fora do schema. `Pendente` significa que não houve acesso seguro somente-leitura ao banco.

| Objeto e estruturas relevantes | Migration esperada | Schema Drizzle atual | Banco real | Situação |
|---|---|---|---|---|
| `users`: credenciais, perfil, ativo, timestamps; unique `openId` | 0000, 0003, 0004_local_auth | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `leads`: campos operacionais, `extraData`, PDV, campanha, SLA e soft delete; 8 índices | 0001, 0002, 0003, 0004_campaigns | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `lead_activities`: enum ampliado; índices por lead/data | 0001, 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `lead_imports` | 0001 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `seller_profiles`: unique `userId`, índice `store` | 0001 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `pdvs`: unique `code`, índice `isActive` | 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `user_pdvs`: unique (`userId`,`pdvId`), índices individuais | 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `follow_ups`: índices (`leadId`,`dueAt`) e `dueAt` | 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `audit_logs`: índices por entidade, data e usuário | 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `notifications`: índice (`userId`,`createdAt`) | 0003 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `campaigns`: ativo, congelado e soft delete; índices ativo/data | 0004_campaigns, 0006 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `campaign_pdvs`: unique e índices por campanha/PDV | 0004_campaigns | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `password_reset_requests`: índices pendente/usuário | 0005 | Representado integralmente | Pendente | A/B/C/D a confirmar |
| `maintenance_jobs` | Nenhuma | Representado, porém sem uso atual | Pendente | provável E; legado do bootstrap |
| `__drizzle_migrations` | Gerida pelo Drizzle, não pelo schema da aplicação | Não representada | Pendente | deve ser auditada separadamente |

Não há chaves estrangeiras físicas definidas pelas migrations ou pelo schema atual; os relacionamentos são lógicos. Isso deve ser preservado como estado V1 durante a reconciliação, salvo decisão explícita posterior.

## 4. Divergências confirmadas no repositório

1. **Baseline recuperada, não comprovada historicamente.** A estrutura de `0000` é compatível com o snapshot inicial de `users`, mas o arquivo histórico e seu hash Drizzle original não foram encontrados no Git local. Ela é um baseline parcial do banco completo e baseline específico de `users`.
2. **Journal historicamente incompleto.** Antes da estabilização, os arquivos de campanhas, redefinição de senha e congelamento não estavam no journal. O journal atual já os referencia, mas isso não prova que foram executados ou registrados no banco.
3. **Objeto legado fora das migrations.** `maintenance_jobs` foi criado pelo bootstrap automático, não por migration. Não deve ser recriado, removido ou alterado nesta fase.
4. **Nome duplicado de prefixo.** Há dois arquivos `0004_*`. O journal os ordena de forma inequívoca, mas o prefixo duplicado aumenta o risco operacional e deve ser mantido apenas por compatibilidade até a reconciliação.

## 5. Auditoria necessária no banco real

É necessário obter, usando uma conta sem permissões de escrita, o resultado destes comandos no banco de produção e no clone de homologação:

```sql
SELECT DATABASE() AS database_name, @@version AS server_version;
SHOW TABLES;
SHOW CREATE TABLE `__drizzle_migrations`;
SELECT id, hash, created_at FROM `__drizzle_migrations` ORDER BY created_at, id;

SELECT table_name, column_name, column_type, is_nullable, column_default, extra
FROM information_schema.columns
WHERE table_schema = DATABASE()
ORDER BY table_name, ordinal_position;

SELECT table_name, index_name, non_unique, seq_in_index, column_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
ORDER BY table_name, index_name, seq_in_index;
```

Também devem ser capturados `SHOW CREATE TABLE` para cada tabela da matriz. Nenhum desses comandos altera dados ou schema.

## 6. Estratégia de reconciliação recomendada

Não criar agora uma migration executável de “baseline” que faça `CREATE TABLE`, `ALTER TABLE` ou `INSERT`. Ela teria alto risco de conflitar com estruturas já criadas pelo bootstrap.

Em vez disso, a reconciliação deve ter dois artefatos revisáveis:

1. Um **manifesto de baseline V1** fora da pasta de migrations executáveis, contendo a ordem do journal, hash de cada SQL, estrutura esperada e evidência de homologação.
2. Um **runbook de stamping**, executado somente após a confirmação de igualdade estrutural no clone. Ele deve registrar no ledger do Drizzle somente as migrations cujos efeitos já existam integralmente no banco, usando os valores que o Drizzle atual espera. Não deve recriar qualquer estrutura.

Tratamento por classe:

- **A:** manter o registro; validar hash e data.
- **B:** após comparar integralmente estrutura, índices e enums, fazer stamping no clone; repetir em produção somente após aprovação.
- **C:** não fazer stamping. Criar futuramente uma migration incremental, revisada, limitada ao objeto ausente.
- **D:** interromper; decidir uma migration de compatibilidade específica depois de backup e análise de dados.
- **E:** inventariar e manter intacto. `maintenance_jobs` deve permanecer legado até uma decisão explícita de aposentadoria.

Para `0000`, primeiro procurar o hash/registro real. Se houver hash divergente, recuperar o SQL original de um artefato de deploy ou tratar o banco como baseline pré-existente no manifesto; não sobrescrever nem forjar um registro sem validar o comportamento do Drizzle em homologação.

## 7. Homologação

1. Criar uma cópia consistente e isolada do banco, incluindo `__drizzle_migrations`.
2. Executar apenas as consultas de inventário acima e produzir o diff estrutural da matriz.
3. Congelar alterações de schema no repositório durante a validação.
4. Confirmar o mecanismo exato de hash/data usado pela versão instalada do Drizzle contra o clone.
5. Aplicar o runbook de stamping no clone, somente para classificações B confirmadas.
6. Rodar `drizzle-kit migrate` no clone sem permitir DDL inesperado; o resultado esperado é nenhuma migration V1 pendente.
7. Criar e testar uma migration nova, inofensiva e aprovada, no clone para provar o fluxo: schema existente + ledger reconciliado → próxima migration.
8. Executar login, leads, campanhas, importação e consultas de dashboard no clone; comparar contagens antes/depois.

Critérios de aprovação da homologação:

- nenhuma tabela, coluna, enum ou índice V1 aparece como pendente sem justificativa;
- nenhum `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `DELETE` ou atualização de dados ocorre ao validar o histórico V1;
- a próxima migration nova é aplicada uma única vez e aparece no ledger;
- contagens e amostras de dados operacionais permanecem idênticas antes/depois.

## 8. Produção e rollback

Produção só deve ser tratada após a homologação aprovada, janela de manutenção, backup testado e exportação prévia de `__drizzle_migrations` e de todo o schema.

O rollback da reconciliação é somente de metadados: restaurar a cópia exportada de `__drizzle_migrations` caso o runner identifique uma pendência inesperada. Não se deve usar rollback por `DROP`, recriação de tabela ou restauração parcial de dados. Se houver qualquer DDL inesperado, interromper antes de confirmar a operação e restaurar o clone/backup conforme o runbook aprovado.

## 9. Condições para considerar o banco pronto para V2

1. Banco real classificado integralmente na matriz, sem itens pendentes.
2. Ledger Drizzle compatível com os arquivos SQL canônicos e sua ordem.
3. `0000` validada ou formalmente tratada como baseline legado documentado.
4. `maintenance_jobs` inventariada como legado, sem ação destrutiva.
5. Clone homologado com sucesso para uma migration nova.
6. Backup restaurável validado e runbook de produção aprovado.
7. Próxima alteração de schema criada exclusivamente como migration Drizzle revisada.

## Conclusão

O banco **não está pronto para iniciar migrations V2 ainda** porque a evidência do schema real e do ledger `__drizzle_migrations` não está disponível neste ambiente. A próxima ação segura é fornecer os resultados somente-leitura indicados ou configurar uma conexão de auditoria para um clone de homologação. Nenhuma reconciliação foi executada nesta etapa.

---

## Adendo CODEX 003B — tentativa de auditoria do banco real

Data: 23/09/2026.

Foi realizada nova verificação exclusivamente de leitura da estação de trabalho e do contexto de publicação disponível nesta sessão. O resultado foi:

- não há `DATABASE_URL` ou `APP_DATABASE` definidos no processo;
- o repositório possui somente `.env.example`, sem valores de conexão;
- o painel Render foi posteriormente confirmado como conectado, e identifica o ambiente efetivamente publicado como Web Service `playcell-leads`, serviço `srv-dancvejtqb8s73bg8q4g`, na branch `main`, com último deploy bem-sucedido do commit `d878309b591dd837c429ddf29ba09805d185de82`;
- as alterações locais de estabilização CODEX 002 ainda estão fora desse deploy; portanto, a auditoria do banco deve considerar que o serviço em produção permanece no commit publicado `d878309` até que um deploy futuro seja explicitamente aprovado;
- a tela de Environment confirma, sem revelar valores, que esse serviço possui `DATABASE_URL` e `APP_DATABASE`, além de variáveis administrativas e de autenticação;
- o Shell do Render não está disponível para este serviço no plano Free. A tentativa de abrir o Shell apresentou explicitamente que o acesso exige upgrade; não foi executado comando remoto algum;
- por isso, não foi aberta conexão com banco algum e **nenhuma** consulta SQL foi executada contra produção ou homologação.

O identificador não sensível do serviço Render anteriormente associado ao projeto é `srv-dancvejtqb8s73bg8q4g`, mas ele não fornece, por si só, uma conexão de banco e não foi usado para executar nenhuma alteração.

### Evidência ainda necessária para completar a matriz

É necessário um dos seguintes meios, com privilégios exclusivamente de leitura:

1. uma `DATABASE_URL` temporária apontando para um clone de homologação; ou
2. a saída sanitizada das consultas de inventário do capítulo 5; ou
3. acesso externo liberado pelo provedor do banco para uma conta de auditoria; ou
4. uma sessão Render em plano com Shell disponível, para executar exclusivamente as consultas de inventário.

Até essa evidência existir, os itens de banco real da matriz permanecem corretamente classificados como **Pendente de evidência**, e não podem ser convertidos para A, B, C, D ou E com segurança.

### Resposta de prontidão

**Não. O banco não pode avançar para a homologação da primeira migration V2 nesta etapa.**

Tecnicamente, ainda não foi possível comparar os hashes e datas de `__drizzle_migrations`, nem confirmar se os efeitos de `0000`, `0004_campaigns`, `0005` e `0006` existem no schema real. Prosseguir sem essas verificações poderia fazer o Drizzle tentar reaplicar DDL sobre estruturas já existentes ou deixar uma divergência histórica invisível.

---

## Adendo CODEX 003C — infraestrutura do banco e preparação de homologação

Data: 23/09/2026. Este levantamento não abriu conexões de banco, não revelou valores secretos e não alterou infraestrutura.

### Ambiente publicado confirmado

| Item | Evidência não sensível |
|---|---|
| Serviço publicado | Render Web Service `playcell-leads` (`srv-dancvejtqb8s73bg8q4g`) |
| Repositório/branch | `cleitongerber/playcell-leads`, `main` |
| Commit publicado | `d878309b591dd837c429ddf29ba09805d185de82` |
| Configuração de banco | O serviço possui `DATABASE_URL` e `APP_DATABASE` configuradas no Render; valores não foram abertos ou copiados. |
| Alterações CODEX 002 | Permanecem locais, fora do deploy publicado. |

### Provedor e engine identificados

- **Provedor:** PingCAP TiDB Cloud.
- **Engine:** TiDB, acessado pelo protocolo e driver MySQL (`mysql2`/Drizzle MySQL).
- **Segurança de transporte esperada:** TLS 1.2, conforme o cliente de banco do projeto e o histórico do commit que introduziu a conexão dedicada.
- **Host/domínio e identificador do cluster:** não foram expostos. O painel Render oculta corretamente a URL; a identificação não sensível do cluster precisa ser obtida no console TiDB Cloud pelo proprietário da conta.
- **Plano da instância:** não confirmado. É necessário identificar no console se a instância é TiDB Cloud Starter, Essential ou Dedicated; essa informação define a disponibilidade de SQL Editor, Data Branch e restauração.

### Acesso e auditoria somente leitura

TiDB Cloud suporta endpoint público para clientes SQL externos em instâncias Starter/Essential, sujeito ao modelo de endpoint e às configurações do projeto. Também oferece SQL Editor para os tipos de instância suportados. A disponibilidade efetiva para este cluster não pode ser confirmada pelo painel Render.

Há duas formas seguras de auditoria:

1. O proprietário usa o console TiDB Cloud e atribui a um auditor o papel de projeto/instância **Data Access Read-Only**, que permite visualizar dados pelo SQL Editor, sem permissão de escrita.
2. O proprietário cria um usuário SQL específico para auditoria com a função embutida **Database Read-Only** ou privilégio `SELECT` limitado ao banco da aplicação. Essa credencial deve ser temporária, armazenada em cofre seguro e revogada após a auditoria.

Nenhuma dessas ações foi executada. A criação de usuário, função, token ou chave requer intervenção do proprietário/Project Owner.

### Console SQL, clone e branch

- **Console SQL:** TiDB Cloud disponibiliza SQL Editor para instâncias Starter e, conforme o tipo de recurso, acesso de dados somente leitura por papel de projeto/instância. O Project Owner deve confirmar a presença de SQL Editor para o cluster atual.
- **Data Branch:** TiDB Cloud oferece branches isoladas que contêm uma cópia divergente dos dados. A funcionalidade é compatível com Starter e Essential; não está disponível para Dedicated. A confirmação do plano é obrigatória antes de escolhê-la.
- **Clone por backup:** TiDB Cloud permite restaurar um snapshot para uma nova instância Starter/Essential. É a alternativa de cópia mais previsível quando o branch não estiver disponível. As credenciais e permissões da origem não são transferidas automaticamente, o que é desejável para isolar homologação.

### Procedimento recomendado de homologação

**Opção recomendada: restauração de snapshot em uma nova instância TiDB Cloud privada**, denominada de forma inequívoca, por exemplo `playcell-leads-v2-hml`.

Essa alternativa cria isolamento completo do banco de produção e mantém um ponto de partida reproduzível para a reconciliação do ledger e a primeira migration V2. Se o proprietário confirmar que a instância é Starter/Essential e que Data Branch está habilitado, uma branch do ponto atual também é aceitável para testes rápidos; o snapshot restaurado continua sendo a escolha mais conservadora para validação formal de migrations.

Passos futuros, todos manuais e sujeitos à aprovação posterior:

1. No console TiDB Cloud, identificar a instância de produção pelo endpoint/cluster, sem copiar a URL de conexão para o relatório.
2. Confirmar backup automático disponível e escolher o snapshot mais recente consistente.
3. Restaurar **para uma nova instância**, nunca sobre a origem; manter a nova instância privada e no mesmo projeto/região quando apropriado.
4. Criar no clone uma conta SQL `Database Read-Only` para a auditoria 003B e, separadamente, uma conta restrita de aplicação para homologação.
5. Criar um serviço Render de homologação separado, com variáveis próprias apontando somente para o clone. Não reutilizar nem alterar o serviço de produção.
6. Executar a reconciliação do histórico primeiro no clone; somente após validação, planejar a primeira migration V2.

### Ações que exigem o proprietário da conta

- Acessar o console TiDB Cloud associado ao endpoint da aplicação.
- Confirmar plano, região, nome/identificador não sensível e recursos habilitados da instância.
- Criar acesso de auditoria somente leitura ou delegar o papel correspondente.
- Criar Data Branch ou restaurar backup para a nova instância.
- Aprovar eventual custo do clone/branch e manter o ambiente privado.
- Criar o serviço Render de homologação e configurar suas variáveis, sem revelar segredos no chat.

### Conclusão de prontidão

O serviço de produção permanece corretamente identificado e continua no commit `d878309b591dd837c429ddf29ba09805d185de82`. O projeto está **pronto para preparar uma homologação isolada**, mas ainda **não está autorizado nem tecnicamente verificado para executar a primeira migration V2**. A próxima ação segura é o proprietário criar ou disponibilizar o clone e o acesso somente leitura; nenhuma alteração de produção é necessária para isso.
