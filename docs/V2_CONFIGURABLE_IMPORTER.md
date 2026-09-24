# Importador configurável V2

## Fluxo e fonte de verdade

O importador usa duas fases explícitas:

1. `draft`: o backend recebe um CSV UTF-8 limitado, remove BOM, detecta `,` ou `;` e grava apenas linhas de staging em `lead_import_rows`. Nenhum lead é criado.
2. `validated`: o backend aplica o mapeamento, regras de PDV, conversões e política de duplicidade. A prévia e os problemas vêm dessas linhas processadas.
3. `processing` → `completed`: somente a confirmação explícita muda um batch validado para processamento. A mudança é condicional (`validated` → `processing`), portanto dois cliques ou requisições concorrentes não duplicam a importação.

Um batch concluído é histórico; não há exclusão física de batch, template versionado ou issues.

## Templates e campos

- `import_templates` guarda a identidade reutilizável.
- `import_template_versions` e `import_template_fields` guardam um mapeamento imutável.
- Cada `lead_import_batches.templateVersionId` referencia precisamente a versão usada.
- `custom_field_definitions` define o esquema de `leads.customData`; não há DDL dinâmico por campanha.

Alterar o mapeamento de um template cria uma versão nova. Alterar o tipo de um campo personalizado já existente é bloqueado para não interpretar dados históricos de forma incompatível.

## PDV, tenant e permissões

Todo batch e toda linha carregam `partnerId`; campanhas, PDVs, templates, campos e leads são buscados sempre dentro do `PartnerContext` do backend.

- Partner Admin e Super Admin podem configurar e importar no parceiro ativo.
- Manager só opera campanha/PDVs dentro de seu escopo e só revisa seus próprios batches.
- Seller não possui procedimentos administrativos de importação.

Um arquivo com vários PDVs exige coluna mapeada para PDV, salvo quando há um PDV único na campanha ou um PDV foi escolhido explicitamente para todo o arquivo. O backend compara referência de código/nome apenas com PDVs ativos da própria campanha e do próprio parceiro.

## Duplicidade e atualização segura

As políticas são registradas por parceiro e podem ter override de campanha. No momento da validação, o batch recebe um snapshot de política, estratégia e campos seguros.

- `REJECT`: duplicidades são recusadas na confirmação.
- `ALLOW`: duplicidades podem gerar outro lead.
- `UPDATE_SAFE_FIELDS`: atualiza somente `name`, `phone`, `email`, `sourceId` e união de `customData` quando configurados.

Nenhuma atualização de importação altera responsável, status, timeline existente, follow-ups, evidências ou exclusão lógica. Atualizações que realmente mudam um campo seguro recebem evento `import_updated`; leads novos recebem `lead_imported`.

## Consistência e limites

O CSV bruto não vai para `audit_logs`. As issues registram código, linha, campo e explicação segura, sem repetir os valores pessoais da planilha. O arquivo é limitado a 5 MiB, 20.000 linhas e 200 colunas. A validação e a persistência percorrem linhas em chunks de 250.

Cada chunk que cria/atualiza leads também cria a timeline correspondente na mesma transação. Antes da confirmação e entre chunks, o backend revalida campanha, congelamento e escopo de PDV. Se uma falha interromper um batch já em processamento, ele fica `failed`, preservando contagens e evitando nova confirmação automática.

## Validação integrada pendente

Os testes unitários cobrem parser, BOM/delimitador, normalizações, mapeamento, campos personalizados, política de duplicidade, ciclo da campanha e token de confirmação. Ainda é necessário executar a migration `0006_v2_configurable_importer.sql` em MySQL/TiDB V2 descartável para validar constraints, transações, paginação SQL e concorrência com o driver real. Não usar a base V1/produção para esse teste.
