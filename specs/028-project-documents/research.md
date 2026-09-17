# Research: Documentos do projeto

## Catálogo lógico e versões imutáveis

**Decision**: Separar o documento lógico de suas versões. O documento guarda classificação, responsável, regra de aceite, etapa exigida, versão vigente e arquivamento; cada versão guarda conteúdo, procedência, integridade e aceite.

**Rationale**: Proposta, contrato ou desenho continuam sendo o mesmo documento de negócio ao receber uma revisão. Essa separação torna a versão vigente inequívoca e preserva auditoria sem copiar os metadados de controle.

**Alternatives considered**: Uma linha independente por arquivo dificulta descobrir a versão vigente. Sobrescrever o arquivo perde histórico e torna aceitações anteriores ambíguas.

## Armazenamento seguro

**Decision**: Reutilizar `backend/src/lib/documents/storage.js` sob o prefixo `Projetos/<código>/Documentos/<tipo>/`, validar o conteúdo antes da gravação, calcular SHA-256 e servir o arquivo por rota autenticada. O limite inicial configurável será 20 MB.

**Rationale**: A biblioteca existente já protege contra travessia de diretório, normaliza caminhos e centraliza escrita, resolução e remoção. O limite acompanha o fluxo de PDF de Assinaturas e cabe no padrão atual de uploads via corpo JSON com limite específico.

**Alternatives considered**: Expor o caminho de upload enfraquece autorização por projeto. Criar um segundo mecanismo de armazenamento duplicaria proteção e política de caminho. Multipart foi adiado porque o repositório já padroniza esses uploads como data URL.

## Formatos aceitos

**Decision**: Aceitar inicialmente PDF, DOCX, XLSX, PNG, JPEG, DWG e DXF. Validar extensão e MIME declarados, assinatura binária quando houver formato reconhecível e estrutura ZIP mínima para Office Open XML. Somente PDF pode iniciar Assinaturas.

**Rationale**: O conjunto cobre contratos/propostas, planilhas, desenhos e evidências usuais. Uma allowlist explícita reduz risco e permite mensagem clara.

**Alternatives considered**: Aceitar qualquer arquivo amplia a superfície sem necessidade. Converter todos os formatos para PDF alteraria conteúdo técnico e atrasaria o MVP.

## Aceite pertence à versão

**Decision**: Modos `NONE`, `INTERNAL`, `CLIENT` e `SIGNATURE`. A situação fica na versão vigente e registra decisão, data de negócio, autor, instante e observação. Nova versão nasce `PENDING`, salvo modo `NONE`, que nasce `NOT_REQUIRED`.

**Rationale**: Um aceite de contrato ou desenho revisado não vale automaticamente para a revisão seguinte. Guardar a decisão na versão evita herança silenciosa.

**Alternatives considered**: Aceite no documento lógico seria simples, mas aprovaria revisões nunca avaliadas. Um checklist paralelo repetiria estado e criaria divergência.

## Requisitos e gates

**Decision**: O documento pode ser informativo ou obrigatório em `HANDOVER`, `MOBILIZATION` ou `CLOSEOUT`. Só requisitos explícitos entram no cálculo. Alteração que torna um requisito de mobilização não pronto invalida a autorização existente, incrementa a versão do workflow e registra evento, sem mover o card.

**Rationale**: Preserva projetos legados e mantém o padrão atual de autorização versionada. O usuário vê a causa sem perder o contexto da etapa.

**Alternatives considered**: Tornar tipos obrigatórios globalmente bloquearia obras antigas e projetos com condições diferentes. Mover o card automaticamente confundiria controle documental com decisão operacional.

## Fatos comerciais e evidências

**Decision**: Permitir vínculo opcional de um fato comercial ao documento lógico correspondente. Uma proposta vigente pode satisfazer a evidência do handover, mas nunca muda por si só o status de proposta aceita, pedido recebido ou contrato assinado.

**Rationale**: Arquivo e fato comercial respondem perguntas diferentes. O vínculo reduz repetição sem inferir uma decisão que deve vir do Comercial ou do CRM.

**Alternatives considered**: Inferir confirmação pelo upload geraria liberações falsas. Manter referência apenas em texto impede rastrear qual revisão sustenta o fato.

## Integração futura com CRM

**Decision**: Versões externas guardam origem, identificador externo, versão da fonte, data de atualização e URL. O serviço interno fará upsert idempotente; evento repetido não duplica e evento mais antigo não substitui o vigente. Conteúdo CRM é somente leitura.

**Rationale**: O contrato absorve a integração futura sem decidir agora transporte, autenticação ou fornecedor. A fonte oficial continua explícita.

**Alternatives considered**: Baixar todo conteúdo para o FiltroAPP gera duplicação e retenção desnecessária. Esperar o CRM existir exigiria remodelar o catálogo depois.

## Assinaturas

**Decision**: Uma versão PDF gerenciada pode criar e vincular um `SignatureDocument`. O usuário segue para `/assinaturas?doc=<id>`; status, arquivo final e auditoria continuam pertencendo ao módulo de Assinaturas.

**Rationale**: O fluxo existente já valida PDF, mantém signatários, trilha e documento final. O vínculo fornece visão integrada sem duplicar uma regra sensível.

**Alternatives considered**: Copiar signatários/estados para o projeto criaria duas fontes de verdade. Embutir o editor de assinatura no diálogo aumentaria a complexidade e reduziria espaço.

## RDOs e relatórios

**Decision**: Agregar os registros atuais por consulta ao projeto e apresentá-los numa seção operacional somente leitura. Não criar `ProjectDocumentVersion` para eles.

**Rationale**: RDOs e relatórios já possuem ciclo, versões, aprovações, anexos e permissões próprios. Uma projeção mantém o estado atualizado e evita cópia.

**Alternatives considered**: Espelhar cada arquivo exigiria sincronização bidirecional e poderia mostrar estados desatualizados.

## Permissões

**Decision**: Usuários com acesso efetivo ao projeto consultam. Líder e gestores administram documentos manuais; Comercial mantém proposta comercial, pedido e contrato; Operações mantém proposta técnica, desenhos, especificações e evidências; Administrativo/RH e QSMS mantêm requisitos/certificados de sua área; Ativos mantém certificados técnicos dos equipamentos. Origem CRM é somente leitura para todos.

**Rationale**: A matriz acompanha as responsabilidades já usadas pelas frentes do workflow e mantém coordenação com o Líder.

**Alternatives considered**: Liberar edição a todo visualizador enfraquece autoria. Restringir tudo ao Líder impede as áreas responsáveis de concluir sua parte.

## Arquivamento e retenção

**Decision**: Arquivar oculta o documento das listas ativas, preserva versões e pode reabrir bloqueio. Restauração é permitida. Expurgo físico e política de retenção ficam fora da entrega.

**Rationale**: Auditoria e assinaturas exigem histórico. A empresa ainda não definiu quando um arquivo pode ser eliminado definitivamente.

**Alternatives considered**: Exclusão imediata é irreversível e pode romper evidências. Proibir arquivamento deixaria duplicidades ativas.
