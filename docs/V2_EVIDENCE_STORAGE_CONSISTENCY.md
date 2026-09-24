# Evidências V2: consistência entre storage e banco

As evidências são metadados no banco e objetos privados no storage. O arquivo
não é gravado no banco, e a chave física nunca é enviada pelo cliente.

1. O backend valida sessão, parceiro, escopo do lead, evento da timeline,
   MIME/extensão/assinatura e tamanho.
2. Ele gera uma chave opaca `v2/evidences/{partnerId}/{uuid}` e cria um
   registro de intenção com `storageStatus = uploading`.
3. O backend envia o objeto ao storage com essa chave exata.
4. Depois do envio, uma transação marca a evidência como `available`, atualiza
   a avaliação de governança do evento e registra a auditoria sem URL ou chave.

Se o envio falhar, a intenção é marcada `failed`. Se o envio tiver sucesso mas
a confirmação no banco falhar, o registro permanece `uploading`; assim o
objeto potencial não fica sem referência e uma futura rotina administrativa de
reconciliação pode verificá-lo. A aplicação não trata esse estado como
evidência disponível.

Downloads passam pela API V2, que repete as verificações de tenant, PDV e
carteira antes de pedir uma URL temporária. O proxy legado recusa o prefixo
`v2/evidences/` para impedir bypass dessa autorização.

Remoção administrativa é lógica: o objeto deixa de ser acessível e o registro,
a timeline e a auditoria são preservados. `retentionDays` prepara uma futura
rotina de expurgo físico, que não faz parte desta etapa.
