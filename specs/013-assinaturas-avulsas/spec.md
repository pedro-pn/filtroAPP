# Feature Specification: Módulo de Assinaturas Avulsas

**Feature Branch**: `feat/signature-module`

**Created**: 2026-08-21

**Status**: Ready for Implementation

**Input**: Briefing de 33 seções apresentado pelo solicitante em 2026-08-21 (preservado em `spec-input.md`):
"Módulo que permita a um usuário da aplicação fazer upload de um PDF avulso e solicitar assinaturas,
utilizando o mecanismo interno de assinatura já existente. Upload → prévia → cadastro dos assinantes →
posicionamento dos campos → validade dos links → validação/publicação → geração dos links individuais →
envio de notificações quando houver e-mail → acompanhamento → documento final assinado e trilha de auditoria."

> **Nota de processo**: especificação consolidada e validada pelo workflow `/speckit-specify` em 2026-08-27.
> A partir desta versão, ela é a fonte de verdade para a atualização do plano, dos contratos e das tarefas.

## Clarifications

### Session 2026-08-21

Sete decisões de produto foram tomadas pelo solicitante. Todas já estão refletidas nesta spec:

- **Permissão**: uma única permissão de acesso ao módulo, sem hierarquia interna. Quem a possui usa o módulo
  por inteiro; quem não a possui não acessa nada dele.
- **Isolamento**: total. Nenhum usuário vê documento de outro — **inclusive administradores**. Não existe
  visão administrativa do acervo alheio dentro da aplicação.
- **Desligamento de funcionário**: resolvido pela exclusão da conta, não por acesso administrativo. Ao excluir
  uma conta, os documentos **não concluídos** dela são apagados e os **concluídos** são preservados (porque
  carregam assinaturas de terceiros com valor probatório). A confirmação mostra a contagem de cada grupo antes
  de o administrador confirmar.
- **Acesso do assinante externo ao documento final**: até o vencimento do convite dele, sem prorrogação.
  Depois disso, apenas o proprietário obtém o documento pela área autenticada.
- **Retenção após exclusão pelo proprietário**: 90 dias antes da remoção definitiva dos arquivos. A trilha de
  auditoria é preservada mesmo depois disso.
- **Exclusão de arquivos na exclusão de conta**: inacessibilidade imediata (não se aplica a janela de 90 dias;
  a remoção física pode ser repetida de forma segura depois do commit).
- **Nome do documento**: campo próprio, opcional, com o nome do arquivo enviado como valor inicial, editável
  apenas enquanto o documento estiver em rascunho.

### Session 2026-08-27

As inconsistências encontradas na análise pré-implementação foram resolvidas com estas decisões:

- **Conclusão recuperável**: após a última assinatura, o documento pode permanecer temporariamente como
  "finalizando". Ele só é apresentado como concluído quando o PDF final e seu comprovante de integridade
  estiverem disponíveis. Falhas são tentadas novamente sem exigir nova assinatura e sem duplicar eventos.
- **Restauração de documento excluído**: links anteriores nunca voltam a funcionar. Para assinantes ainda
  pendentes, a restauração gera novos convites; assinaturas já concluídas permanecem imutáveis.
- **Exclusão de conta e arquivos**: antes da exclusão, os arquivos dos documentos que serão removidos são
  colocados em área inacessível ao aplicativo. Falha nessa preparação aborta a exclusão. Depois do commit, a
  remoção física é repetida automaticamente até concluir, sem tornar os arquivos acessíveis.
- **Documento concluído sem proprietário**: não aparece em nenhuma área autenticada, inclusive para
  administradores. A verificação pública por código permanece disponível e um assinante que já assinou pode
  obter o PDF final enquanto seu convite continuar válido. O nome de quem solicitou é preservado como registro
  histórico do documento.
- **Auditoria e privacidade**: a identidade, ação e data de um evento nunca são alteradas ou removidas. IP e
  User-Agent podem ser anonimizados após o prazo de privacidade, sem alterar o significado do evento.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Coletar assinaturas em um PDF avulso (Priority: P1) 🎯 MVP

Um usuário com a permissão do módulo envia um PDF, cadastra as pessoas que precisam assinar, marca no
documento onde cada uma assina, define por quanto tempo os links valem e publica a solicitação. O sistema gera
um link exclusivo por assinante, que o proprietário copia e distribui pelo canal que quiser (WhatsApp, Slack,
conversa presencial). Cada pessoa abre o seu link, vê o documento, assina e confirma. Quando a última assina,
o sistema finaliza o artefato de modo recuperável e só então apresenta o documento como concluído; o
proprietário obtém o PDF final com todas as assinaturas aplicadas nas posições escolhidas e folha de evidências.

**Why this priority**: é o módulo inteiro em sua forma mínima. Sem esta história não existe produto — e com
ela sozinha já se resolve o problema real, mesmo sem nenhum envio automático de e-mail.

**Independent Test**: enviar um PDF de 3 páginas, cadastrar dois assinantes **sem e-mail**, posicionar um
campo para cada, publicar com validade de 15 dias, copiar os dois links, abrir cada um em janela anônima e
assinar. Verificar a transição temporária por "finalizando", seguida de conclusão com PDF íntegro, duas
assinaturas nas posições marcadas e folha de evidências. Nenhum e-mail é enviado em nenhum momento.

**Acceptance Scenarios**:

1. **Given** um usuário com a permissão do módulo, **When** ele envia um arquivo PDF válido, **Then** o
   documento é criado como rascunho, exibindo nome, número de páginas e data de criação.
2. **Given** um usuário envia um arquivo que não é PDF, ou um PDF corrompido, protegido por senha ou acima do
   limite de tamanho, **When** confirma o envio, **Then** o sistema recusa com mensagem em pt-BR explicando o
   motivo e nenhum documento é criado.
3. **Given** um documento em rascunho, **When** o proprietário cadastra um assinante informando apenas o nome,
   **Then** o assinante é aceito sem e-mail.
4. **Given** um documento em rascunho com dois assinantes, **When** o proprietário marca uma área da página 1
   para o primeiro e uma área da página 3 para o segundo, **Then** cada campo fica visivelmente associado ao
   seu assinante e a posição é preservada ao recarregar a página.
5. **Given** um campo posicionado, **When** a mesma tela é aberta em outra largura de tela ou em um celular,
   **Then** o campo aparece exatamente sobre o mesmo ponto do documento.
6. **Given** um documento em rascunho onde um dos assinantes não tem campo posicionado, **When** o
   proprietário tenta publicar, **Then** o sistema recusa e informa quais assinantes estão pendentes.
7. **Given** um documento em rascunho sem nenhum assinante, ou com assinante sem nome, ou com prazo de
   validade inválido, **When** o proprietário tenta publicar, **Then** o sistema recusa e lista as pendências.
8. **Given** um documento válido, **When** o proprietário publica escolhendo a validade dos links, **Then** o
   documento passa a "aguardando assinaturas" e cada assinante passa a ter um link exclusivo e diferente dos
   demais.
9. **Given** um documento publicado, **When** o proprietário aciona "copiar link" de um assinante, **Then** o
   link daquele assinante é copiado para a área de transferência com confirmação visual.
10. **Given** um documento publicado, **When** o proprietário tenta alterar o PDF, os assinantes ou as
    posições, **Then** o sistema recusa a alteração.
11. **Given** um link de assinatura válido, **When** o assinante o abre sem estar autenticado, **Then** ele vê
    o documento, o próprio nome e o próprio campo destacado — e **não** vê nome, e-mail ou situação dos demais
    assinantes.
12. **Given** um assinante na página do seu link, **When** ele desenha ou envia sua assinatura e confirma,
    **Then** a assinatura é registrada com data/hora e o assinante recebe confirmação de conclusão.
13. **Given** um assinante que já assinou, **When** ele reenvia a confirmação (duplo clique, recarregar,
    reenviar), **Then** o sistema não registra uma segunda assinatura e apresenta o mesmo resultado da
    primeira.
14. **Given** um documento com 4 assinantes e 2 já assinaram, **When** o proprietário abre a listagem,
    **Then** o documento exibe o progresso "2 de 4 assinaturas".
15. **Given** o último assinante pendente, **When** ele conclui a assinatura, **Then** o documento passa a
    "finalizando" e só muda para "concluído" depois que o PDF final, as assinaturas posicionadas, a folha de
    evidências e o comprovante de integridade estiverem disponíveis.
16. **Given** um documento concluído, **When** o proprietário solicita o download do PDF final, **Then** ele
    recebe o arquivo; **When** outro usuário tenta o mesmo download, **Then** o sistema responde como se o
    documento não existisse.
17. **Given** uma falha temporária durante a geração do PDF final, **When** o processamento é repetido,
    **Then** a assinatura já registrada é preservada, o PDF é gerado uma única vez e o proprietário não
    precisa solicitar nova assinatura.

---

### User Story 2 - Receber o convite por e-mail (Priority: P2)

Quando um assinante tem e-mail cadastrado, ele recebe automaticamente, após a publicação, uma mensagem
informando que há um documento aguardando sua assinatura, quem solicitou, o prazo e um botão para assinar.
Quem não tem e-mail continua recebendo o link pelas mãos do proprietário.

**Why this priority**: elimina o trabalho manual na maioria dos casos, mas o módulo já entrega valor sem isso
— por isso vem depois da US1 e não dentro dela.

**Independent Test**: publicar um documento com um assinante **com** e-mail e outro **sem**; confirmar que só
o primeiro recebe a mensagem. Em seguida, tornar o serviço de e-mail indisponível e publicar de novo:
confirmar que a publicação continua funcionando, que o convite fica marcado como falha de envio e que o link
segue copiável e válido.

**Acceptance Scenarios**:

1. **Given** um documento publicado com um assinante que tem e-mail, **When** a publicação se completa,
   **Then** aquele assinante recebe uma mensagem com o nome do documento, quem solicitou, o prazo de validade
   e o link individual de assinatura.
2. **Given** um assinante sem e-mail cadastrado, **When** o documento é publicado, **Then** **nenhuma**
   tentativa de envio é feita para ele e a interface indica que o link deve ser entregue manualmente.
3. **Given** o serviço de e-mail indisponível, **When** o proprietário publica o documento, **Then** a
   publicação é concluída normalmente, os links permanecem válidos e copiáveis, e a interface sinaliza a falha
   de envio por assinante.
4. **Given** um convite com falha de envio, **When** o sistema tenta novamente de forma automática, **Then**
   uma nova tentativa ocorre sem gerar convite duplicado nem invalidar o link já existente.
5. **Given** um documento concluído, **When** a última assinatura é registrada, **Then** o proprietário é
   notificado da conclusão.

---

### User Story 3 - Administrar convites e acompanhar a trilha (Priority: P3)

O proprietário consegue renovar um convite vencido, revogar um convite enviado por engano, reenviar o e-mail
de quem não recebeu, e consultar o histórico completo do que aconteceu com o documento.

**Why this priority**: é o que recupera o processo quando algo sai do trilho — link vencido, endereço errado,
pessoa trocada. Importante, mas o fluxo feliz da US1 já funciona sem isso.

**Independent Test**: com um documento publicado, renovar o convite de um assinante e confirmar que o link
antigo deixa de funcionar e o novo funciona; revogar o convite do outro e confirmar que ele para de funcionar
imediatamente; abrir o histórico e ver a sequência completa de eventos.

**Acceptance Scenarios**:

1. **Given** um convite vencido, **When** o assinante abre o link, **Then** ele vê uma mensagem informando que
   o link expirou e orientando a solicitar um novo, e não consegue assinar.
2. **Given** um convite vencido ou pendente, **When** o proprietário o renova, **Then** um novo link é gerado,
   **o link anterior deixa de funcionar imediatamente** e o evento fica registrado no histórico.
3. **Given** um convite pendente, **When** o proprietário o revoga, **Then** aquele link para de funcionar na
   hora e o evento fica registrado.
4. **Given** um assinante que **já assinou**, **When** o proprietário tenta revogar ou renovar o convite dele,
   **Then** o sistema recusa e a assinatura registrada permanece intacta.
5. **Given** um convite com e-mail cadastrado, **When** o proprietário aciona "reenviar e-mail", **Then** a
   mensagem é reenviada sem alterar o link existente.
6. **Given** um convite sem e-mail, **When** o proprietário tenta reenviar, **Then** o sistema informa que não
   há endereço cadastrado.
7. **Given** qualquer documento, **When** o proprietário abre o histórico, **Then** ele vê, em ordem
   cronológica e sem lacunas, os eventos de criação, configuração, publicação, criação de convites, envios de
   e-mail, acessos ao link, assinaturas, renovações, revogações e conclusão — cada um com data/hora e, quando
   aplicável, a evidência de origem do acesso.
8. **Given** o histórico de um documento, **When** ele é consultado por qualquer via, **Then** nenhum evento
   expõe o link ou o segredo de acesso de um convite.

---

### User Story 4 - Organizar o acervo (Priority: P4)

O proprietário arquiva documentos que não precisa mais ver na lista principal, cancela uma rodada que não vai
mais acontecer, e exclui documentos que não deveriam existir — sempre sem perder as assinaturas já colhidas
nem o histórico.

**Why this priority**: qualidade de vida e higiene da base. Só passa a incomodar depois de algumas dezenas de
documentos.

**Independent Test**: arquivar um documento concluído e confirmar que ele sai da lista principal, aparece em
"arquivados", continua concluído e com o PDF final disponível; excluir um documento que aguardava assinaturas
e confirmar que os links morrem na hora e o histórico permanece.

**Acceptance Scenarios**:

1. **Given** um documento concluído, **When** o proprietário o arquiva, **Then** ele sai da lista principal,
   passa a aparecer entre os arquivados, **continua concluído** e o PDF final segue disponível.
2. **Given** um documento arquivado, **When** o proprietário o restaura, **Then** ele volta à lista principal
   sem qualquer alteração nas assinaturas.
3. **Given** um documento arquivado com convites pendentes, **When** um assinante abre seu link, **Then** ele
   consegue assinar normalmente — arquivar não interrompe o processo de assinatura.
4. **Given** um documento aguardando assinaturas, **When** o proprietário cancela a rodada, **Then** os
   convites pendentes deixam de funcionar e as assinaturas já registradas são preservadas.
5. **Given** qualquer documento, **When** o proprietário solicita a exclusão, **Then** o sistema exige
   confirmação explícita, com aviso de que os links ativos serão invalidados; para documento **concluído** a
   confirmação é reforçada.
6. **Given** um documento excluído, **When** um assinante tenta usar um link que estava ativo, **Then** o link
   não funciona mais.
7. **Given** um documento excluído dentro do prazo de retenção, **When** o proprietário o restaura, **Then** o
   documento volta com assinaturas e histórico intactos, **os links anteriores continuam inválidos** e novos
   convites são emitidos apenas para os assinantes que ainda precisam assinar.
8. **Given** um documento excluído há mais de 90 dias, **When** a rotina de retenção é executada, **Then** os
   arquivos são removidos em definitivo e **o histórico do documento permanece consultável**.

---

### User Story 5 - Conferir a autenticidade de um documento assinado (Priority: P5)

Qualquer pessoa que receba o PDF final — inclusive fora da empresa — consegue conferir sua autenticidade a
partir de um código impresso no próprio documento, sem precisar de conta.

**Why this priority**: aumenta a confiança no documento final, mas o documento já é utilizável sem isso.

**Independent Test**: concluir um documento, ler o código do PDF final (ou escanear o marcador impresso) e
confirmar que a página de verificação apresenta o documento como válido, com os assinantes e as datas; um
código inexistente apresenta "código inválido".

**Acceptance Scenarios**:

1. **Given** um documento concluído, **When** o PDF final é gerado, **Then** ele contém um código de
   verificação e um marcador que leva à página pública de conferência.
2. **Given** o código de um documento concluído, **When** alguém abre a página de conferência sem estar
   autenticado, **Then** vê o documento como válido, com nome, data de conclusão e a relação dos assinantes
   com suas datas de assinatura.
3. **Given** a página de conferência, **When** ela é exibida, **Then** ela **não** revela e-mails dos
   assinantes, origem do acesso nem o conteúdo do documento.
4. **Given** um código inexistente ou adulterado, **When** alguém o consulta, **Then** a página informa que o
   código é inválido.

---

### User Story 6 - Excluir uma conta sabendo o impacto (Priority: P6)

O administrador do hub exclui a conta de alguém que saiu da empresa e é informado, antes de confirmar,
exatamente quantos documentos de assinatura serão apagados e quantos serão preservados.

**Why this priority**: é a contrapartida do isolamento total decidido nas Clarifications — sem ela, o acervo
de quem sai fica inacessível para sempre. Vem por último porque só importa quando há rotatividade.

**Independent Test**: com um usuário que tem 2 documentos não concluídos e 1 concluído, iniciar a exclusão da
conta como administrador; confirmar que o aviso mostra "2 serão excluídos, 1 concluído será preservado"; após
confirmar, verificar que os 2 desapareceram e que o concluído permanece guardado e inacessível pela aplicação.

**Acceptance Scenarios**:

1. **Given** uma conta com documentos de assinatura, **When** o administrador inicia a exclusão, **Then** a
   confirmação informa quantos documentos serão excluídos permanentemente e quantos concluídos serão
   preservados.
2. **Given** a exclusão confirmada, **When** ela se completa, **Then** os documentos não concluídos são
   removidos e seus arquivos ficam imediatamente inacessíveis ao aplicativo, mesmo que a remoção física ainda
   esteja sendo repetida automaticamente.
3. **Given** a exclusão confirmada, **When** ela se completa, **Then** os documentos concluídos são
   preservados com suas assinaturas e histórico, e o histórico registra a remoção do proprietário.
4. **Given** um documento preservado sem proprietário, **When** qualquer usuário — **inclusive administrador**
   — tenta acessá-lo por uma área autenticada, **Then** o sistema responde como se ele não existisse; a
   verificação pública por código e o download por convite assinado ainda válido continuam disponíveis.
5. **Given** uma conta **sem** documentos de assinatura, **When** o administrador a exclui, **Then** o
   comportamento é idêntico ao atual, sem passo adicional.
6. **Given** uma falha ao preparar banco ou arquivos para a exclusão, **When** a exclusão é processada,
   **Then** a conta não é excluída e os arquivos voltam ao estado acessível anterior; se a falha ocorrer apenas
   na remoção física posterior à confirmação definitiva, os arquivos permanecem inacessíveis e a limpeza é
   repetida.
7. **Given** uma conta com documento em finalização, **When** o administrador tenta confirmar a exclusão,
   **Then** a operação é bloqueada até que o documento seja concluído ou a falha de finalização seja resolvida.

---

### Edge Cases

- **Arquivo enviado não é um PDF de verdade** (extensão trocada, conteúdo de outro tipo): recusado com
  mensagem clara, sem criar documento.
- **PDF protegido por senha ou ilegível**: recusado no envio, não na publicação.
- **PDF com muitas páginas ou muito grande**: recusado com o limite informado na mensagem.
- **Dois assinantes com o mesmo e-mail**: recusado na publicação.
- **Assinante marcado como "sou eu"**: o próprio proprietário pode ser um dos assinantes e assina pelo mesmo
  fluxo público dos demais.
- **Link adulterado em um caractere**: tratado como link inválido, sem revelar se o documento existe.
- **Link aberto depois de o documento ser cancelado ou excluído**: informa que a solicitação não está mais
  ativa.
- **Dois assinantes concluindo ao mesmo tempo**: o documento é concluído uma única vez e apenas um PDF final é
  gerado.
- **Geração do PDF final falha depois da última assinatura**: o documento permanece como "finalizando", a
  assinatura não é perdida e uma nova tentativa idempotente ocorre automaticamente.
- **Página do PDF rotacionada em 90°, 180° ou 270°**: o campo e a assinatura final permanecem no mesmo ponto
  visual marcado pelo usuário.
- **Renovação de convite no exato momento em que a pessoa está assinando**: apenas uma das duas ações prevalece
  e o sistema não fica em estado inconsistente.
- **Tentativa de assinar duas vezes**: a segunda tentativa não cria nova assinatura.
- **Arquivo do documento alterado ou perdido no armazenamento após a publicação**: o sistema detecta a
  divergência, recusa gerar o documento final e informa o problema, em vez de produzir um documento incorreto.
- **Documento parcialmente assinado é excluído e restaurado**: assinaturas já feitas permanecem; convites
  antigos continuam inválidos; novos convites são emitidos somente para quem ainda está pendente.
- **Conta é excluída e a remoção física dos arquivos falha após a confirmação definitiva**: os bytes
  permanecem em área
  inacessível e a limpeza é repetida sem recriar a conta ou os documentos.
- **Conta possui documento finalizando**: a exclusão fica bloqueada para não descartar uma rodada em que todas
  as assinaturas já foram coletadas.
- **Proprietário de documento concluído é removido**: o documento não aparece para usuários autenticados, mas
  o código público continua verificável e o nome do solicitante exibido vem do snapshot preservado.
- **Serviço de e-mail indisponível na hora da publicação**: publicação prossegue; links continuam válidos.
- **Assinante abrindo o link em celular**: todas as telas públicas funcionam em tela estreita, sem rolagem
  horizontal da página.
- **Documento sem nenhuma assinatura ainda, com erro de digitação no assinante**: o proprietário pode voltar o
  documento para rascunho, corrigir e publicar de novo — o que invalida os links anteriores.
- **Documento com pelo menos uma assinatura e necessidade de correção**: não é editável; a saída é cancelar a
  rodada e criar um novo documento, preservando as evidências já colhidas.

## Requirements *(mandatory)*

### Functional Requirements

**Acesso e isolamento**

- **FR-001**: O sistema MUST oferecer uma única permissão de acesso ao módulo, sem distinção de papéis internos.
- **FR-002**: O sistema MUST impedir que usuários sem essa permissão acessem qualquer tela ou operação do
  módulo.
- **FR-003**: Cada documento MUST pertencer exclusivamente ao usuário que o enviou.
- **FR-004**: O sistema MUST impedir que um usuário visualize ou manipule documento de outro usuário em
  **todas** as operações — listagem, visualização, detalhes, prévia, documento original, documento final,
  assinantes, histórico, obtenção e renovação de links, arquivamento, restauração, exclusão e download —
  mesmo que os dois usuários tenham a mesma permissão, o mesmo cargo, ou que o solicitante conheça o
  identificador do documento.
- **FR-005**: O isolamento MUST ser garantido pelo servidor, não apenas pela interface.
- **FR-006**: Ao negar acesso a documento de outro usuário, o sistema MUST responder de forma que não revele se
  o documento existe.
- **FR-007**: Administradores MUST NOT ter acesso a documentos de outros usuários pela aplicação.
- **FR-008**: Assinantes externos MUST NOT obter acesso ao módulo nem à conta do proprietário; seu acesso se
  limita ao fluxo público autorizado pelo seu convite individual.

**Envio do documento**

- **FR-009**: Usuários com a permissão MUST conseguir enviar um documento em PDF.
- **FR-010**: O sistema MUST verificar que o arquivo enviado é realmente um PDF, recusando arquivos de outro
  tipo, corrompidos, protegidos por senha ou acima dos limites configurados de tamanho e número de páginas.
- **FR-011**: O sistema MUST registrar, para cada documento, o nome original do arquivo, o tamanho, o número de
  páginas, o proprietário, um registro histórico do nome do solicitante, a data de criação e a situação atual.
- **FR-012**: O documento MUST iniciar como rascunho enquanto o proprietário prepara assinantes e campos.
- **FR-013**: O sistema MUST permitir um nome próprio para o documento, iniciado com o nome do arquivo enviado
  e editável **apenas** enquanto o documento estiver em rascunho.
- **FR-014**: O sistema MUST preservar tanto o documento original quanto o documento final assinado enquanto
  o documento estiver dentro do período de retenção aplicável.

**Prévia e posicionamento**

- **FR-015**: O sistema MUST exibir uma prévia navegável de todas as páginas do documento.
- **FR-016**: O proprietário MUST conseguir marcar, sobre a prévia, onde cada assinante deve assinar.
- **FR-017**: Cada campo de assinatura MUST estar explicitamente associado a um único assinante, de forma
  visível na interface.
- **FR-018**: A posição registrada MUST ser independente do tamanho de tela, do nível de zoom e da resolução,
  permanecendo correta em qualquer dispositivo, a cada nova exibição e em páginas rotacionadas em 0°, 90°,
  180° ou 270°.
- **FR-019**: O sistema MUST recusar campos posicionados fora dos limites da página ou menores que o tamanho
  mínimo utilizável.

**Assinantes**

- **FR-020**: O proprietário MUST conseguir cadastrar um ou mais assinantes.
- **FR-021**: O nome do assinante MUST ser obrigatório e o e-mail MUST ser opcional.
- **FR-022**: O sistema MUST recusar dois assinantes com o mesmo e-mail no mesmo documento.
- **FR-023**: O proprietário MUST conseguir incluir a si mesmo como assinante.
- **FR-024**: O sistema MUST NOT exigir cadastro de conta para assinantes externos.
- **FR-025**: Todos os assinantes MUST poder assinar de forma independente, em qualquer ordem.

**Publicação**

- **FR-026**: Antes de publicar, o sistema MUST validar que o documento está disponível e íntegro, que existe
  ao menos um assinante, que todos têm nome, que todos têm ao menos um campo posicionado, que cada campo
  pertence a um assinante daquele documento e que o prazo de validade é válido.
- **FR-027**: O sistema MUST recusar a publicação listando todas as pendências encontradas, para que o
  proprietário corrija de uma vez.
- **FR-028**: Após a publicação, o sistema MUST impedir alteração do documento, dos assinantes e das posições.
- **FR-029**: Enquanto **nenhuma** assinatura tiver sido registrada, o proprietário MUST conseguir retornar o
  documento para rascunho, o que invalida todos os links já emitidos.
- **FR-030**: Havendo ao menos uma assinatura registrada, o sistema MUST impedir o retorno para rascunho; a
  correção se dá cancelando a rodada e criando um novo documento.

**Links de assinatura**

- **FR-031**: Cada assinante MUST receber um link exclusivo, distinto do de qualquer outro assinante.
- **FR-032**: O link MUST NOT ser derivável do identificador do documento, do identificador do assinante, do
  e-mail, de sequência numérica ou de qualquer combinação previsível desses dados.
- **FR-033**: Cada convite MUST estar associado de forma inequívoca a um documento, a um assinante, a um prazo
  de validade e a uma situação.
- **FR-034**: O sistema MUST permitir ao proprietário obter e copiar o link de cada assinante enquanto o
  convite estiver ativo, para distribuição por qualquer canal.
- **FR-035**: O sistema MUST registrar no histórico cada obtenção de link pelo proprietário.
- **FR-036**: O sistema MUST NOT expor o link em listagens, mensagens de erro ou registros operacionais.

**Validade e renovação**

- **FR-037**: O proprietário MUST escolher o prazo de validade dos links antes da publicação, por opções
  pré-definidas ou por data específica.
- **FR-038**: O sistema MUST recusar prazos no passado ou acima do limite máximo configurado.
- **FR-039**: Datas e horas MUST ser apresentadas ao usuário no fuso horário adotado pela aplicação.
- **FR-040**: Um link vencido MUST NOT permitir assinatura e MUST apresentar mensagem apropriada ao assinante.
- **FR-041**: O proprietário MUST conseguir renovar um convite pendente ou vencido, gerando um novo link.
- **FR-042**: A renovação MUST invalidar o link anterior imediatamente e registrar o evento no histórico.
- **FR-043**: O proprietário MUST conseguir revogar um convite pendente, invalidando o link imediatamente.
- **FR-044**: O sistema MUST recusar renovação ou revogação de convite já assinado.

**Notificação por e-mail**

- **FR-045**: Havendo e-mail cadastrado, o sistema MUST enviar ao assinante, após a publicação, uma mensagem
  informando que há documento aguardando assinatura, quem solicitou, o prazo de validade e o link individual.
- **FR-046**: Não havendo e-mail, o sistema MUST criar o link normalmente e MUST NOT realizar qualquer
  tentativa de envio.
- **FR-047**: Falha no envio de e-mail MUST NOT impedir a publicação, invalidar links, nem impedir a cópia
  manual do link.
- **FR-048**: O sistema MUST registrar no histórico a solicitação de envio, o envio realizado e a falha de
  envio.
- **FR-049**: O sistema MUST tentar reenviar automaticamente convites com falha, sem duplicar convites nem
  invalidar links.
- **FR-050**: O sistema MUST notificar o proprietário somente depois que o documento final estiver disponível
  e o documento tiver sido concluído.

**Fluxo do assinante**

- **FR-051**: Ao abrir o link, o assinante MUST acessar apenas o documento correspondente ao seu convite.
- **FR-052**: O sistema MUST validar, a cada acesso, a existência do convite, sua validade, a situação do
  documento e a situação do assinante.
- **FR-053**: O assinante MUST conseguir visualizar o documento, localizar seu campo, assinar, confirmar e
  receber retorno de conclusão.
- **FR-054**: O assinante MUST registrar ciência do aviso de privacidade antes de assinar.
- **FR-055**: O sistema MUST NOT expor a um assinante o nome, o e-mail ou a situação individual dos demais
  assinantes.
- **FR-056**: O assinante que concluiu sua assinatura MUST conseguir obter o documento final até o vencimento
  do seu convite, inclusive se a conta do proprietário tiver sido removida.

**Situações**

- **FR-057**: O sistema MUST representar, por assinante, as situações pendente, visualizado, assinado,
  expirado e revogado.
- **FR-058**: O sistema MUST representar, por documento, as situações rascunho, aguardando assinaturas,
  finalizando, concluído e cancelado.
- **FR-059**: O arquivamento MUST ser tratado como atributo de organização, sem alterar a situação do documento
  nem a validade das assinaturas.
- **FR-060**: A interface MUST apresentar, por assinante, nome, e-mail quando houver, situação, data e hora da
  assinatura quando houver, e acesso ao link enquanto aplicável.
- **FR-061**: A listagem MUST apresentar, por documento, nome, data de criação, situação, quantidade de
  assinantes, progresso das assinaturas e indicação de conclusão.

**Conclusão**

- **FR-062**: Quando todos os assinantes obrigatórios concluírem, o sistema MUST iniciar a finalização e MUST
  marcar o documento como concluído somente depois que o documento final íntegro estiver disponível.
- **FR-063**: O sistema MUST gerar um documento final contendo as assinaturas aplicadas nas posições
  escolhidas e uma folha de evidências com os dados de cada assinatura; falhas MUST ser recuperadas por novas
  tentativas idempotentes, sem exigir nova assinatura.
- **FR-064**: O sistema MUST preservar o documento final, suas evidências e seu comprovante de integridade, e
  MUST verificar essa integridade antes de qualquer download.
- **FR-065**: Apenas o proprietário MUST conseguir obter o documento final pela área autenticada.
- **FR-066**: O sistema MUST verificar a integridade do documento original antes de produzir o documento final
  e MUST recusar a geração caso o arquivo tenha sido alterado.
- **FR-067**: O documento final MUST conter um código de verificação que permita a qualquer pessoa conferir sua
  autenticidade sem autenticação.
- **FR-068**: A página pública de verificação MUST apresentar a situação do documento e a relação de
  assinantes com datas, e MUST NOT expor e-mails, origem do acesso ou o conteúdo do documento. A verificação
  MUST continuar disponível para documento concluído preservado sem proprietário.

**Histórico**

- **FR-069**: O sistema MUST manter uma trilha de auditoria somente-adição para cada documento: identidade,
  ação e data do evento MUST NOT ser alteradas ou removidas; IP e User-Agent MAY ser anonimizados após o prazo
  de privacidade sem modificar o significado do evento.
- **FR-070**: A trilha MUST registrar criação, configuração, publicação, retorno a rascunho, criação de
  convites, solicitação/envio/falha de e-mail, obtenção de link, acesso ao link, visualização pelo assinante,
  assinatura, expiração, renovação, revogação, conclusão, geração do documento final, arquivamento,
  restauração, exclusão, restauração de exclusão, remoção de arquivos por retenção e remoção do proprietário.
- **FR-071**: Os eventos de assinatura MUST preservar data e hora, identificação do convite e do assinante, e
  MUST preservar a origem do acesso até o prazo de anonimização aplicável.
- **FR-072**: A trilha MUST NOT conter o link nem o segredo de acesso de nenhum convite.
- **FR-073**: A trilha MUST ser preservada mesmo após a remoção definitiva dos arquivos do documento.

**Organização e exclusão**

- **FR-074**: O proprietário MUST conseguir arquivar e restaurar documentos.
- **FR-075**: O arquivamento MUST remover o documento da listagem principal, mantê-lo em área de arquivados e
  preservar documento, assinaturas e histórico.
- **FR-076**: O proprietário MUST conseguir cancelar uma rodada em andamento, invalidando os convites pendentes
  e preservando as assinaturas já registradas.
- **FR-077**: O proprietário MUST conseguir excluir seus documentos, mediante confirmação explícita na
  interface, reforçada quando o documento estiver concluído.
- **FR-078**: A exclusão MUST invalidar imediatamente todos os links ainda ativos.
- **FR-079**: A exclusão MUST ser reversível durante 90 dias, período após o qual os arquivos são removidos em
  definitivo, preservando-se o histórico.
- **FR-080**: A restauração de um documento excluído MUST NOT reativar os links anteriores e MUST emitir novos
  convites somente para assinantes ainda não assinados.

**Exclusão de conta**

- **FR-081**: Antes de confirmar a exclusão de uma conta, o sistema MUST informar ao administrador quantos
  documentos de assinatura serão excluídos e quantos concluídos serão preservados; a existência de documento
  finalizando MUST bloquear a confirmação até sua resolução.
- **FR-082**: A exclusão de conta MUST remover os documentos não concluídos do usuário e MUST tornar seus
  arquivos imediatamente inacessíveis, com remoção física idempotente e repetida até concluir.
- **FR-083**: A exclusão de conta MUST preservar os documentos concluídos, com assinaturas e histórico, e
  registrar a remoção do proprietário na trilha, preservando também o nome histórico do solicitante.
- **FR-084**: Documentos preservados sem proprietário MUST ser inacessíveis em todas as áreas autenticadas,
  inclusive para administradores; a verificação pública e o download final por convite assinado ainda válido
  MUST continuar disponíveis.
- **FR-085**: Falha na preparação dos dados ou na colocação dos arquivos em área inacessível MUST impedir a
  exclusão da conta e restaurar o estado anterior. Falha na remoção física posterior MUST manter os arquivos
  inacessíveis e MUST ser tentada novamente sem restaurar a conta.

**Integridade e concorrência**

- **FR-086**: Após uma assinatura ser registrada, o sistema MUST impedir a substituição do documento, das
  posições, da identidade do assinante e das evidências.
- **FR-087**: Tentativas repetidas de registrar a mesma assinatura MUST resultar em uma única assinatura
  registrada.
- **FR-088**: Duas conclusões simultâneas MUST resultar em um único documento concluído e um único documento
  final gerado.
- **FR-089**: Renovação de convite concorrente com tentativa de assinatura MUST resultar em apenas uma das
  duas ações prevalecendo, sem estado inconsistente.
- **FR-090**: Reexecução da rotina automática de e-mail MUST NOT gerar envio duplicado. Falha confirmada pelo
  provedor MAY ser repetida; tentativa interrompida com resultado desconhecido MUST exigir reconciliação antes
  de qualquer novo envio automático.

**Segurança operacional**

- **FR-091**: As rotas públicas de assinatura MUST ser protegidas contra tentativas repetidas em volume
  anormal.
- **FR-092**: Páginas e respostas públicas que contenham conteúdo do documento MUST NOT ser armazenadas em
  cache compartilhado.
- **FR-093**: O sistema MUST NOT registrar o link ou o segredo de acesso de um convite em nenhum registro
  operacional, incluindo logs de acesso, captura de erros, observabilidade, proxy ou telemetria.

### Visual/UI Contract *(mandatory if feature touches frontend)*

O módulo é **novo e sem aplicativo de origem** — a exceção de identidade portada do Princípio VI **não se
aplica** e o kit compartilhado e os tokens são obrigatórios em todas as superfícies.

| Surface | Existing reference inspected | Components/classes to use | Form/dropdown pattern | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial contract | Responsive/overflow contract |
|---------|------------------------------|---------------------------|-----------------------|---------------------------|------------------------|---------------------------|------------------------------|
| Listagem de documentos | `frontend/src/pages/qualidade/QualityRecordsTab.tsx` e grade de cards do Estoque | `SearchBar`, `Skeleton`, `Button`, `Toast` de `frontend/src/components/ui/`; tokens de `variables.css` | `select` de status com estados default/foco/disabled/erro do kit | N/A — não há reordenação pelo usuário | `?tab=ativos\|arquivados`, `?status=`, `?q=`; parâmetros incompatíveis limpos ao trocar de aba | Módulo novo: **tutorial permanente de primeiro acesso** (driver.js, padrão de `HubTutorial.tsx`). Campanha de novidade de 10 dias **não se aplica** | Grade `minmax(min(100%, 280px), 1fr)`, filhos com `min-width: 0`, nome de arquivo longo truncado com ellipsis, badges e progresso sem `nowrap` sem limite |
| Novo documento | `frontend/src/components/ui/PdfDropzone.tsx` em uso no Estoque e na Qualidade | `PdfDropzone`, `Modal`, `Button` | `.field-group.field-invalid` + `.field-error` + `aria-invalid` ao tentar salvar vazio | N/A | `?doc=novo` | Passo do tutorial permanente | Dropzone a 100% da largura; modal com rodapé de ações fixo e corpo rolável |
| Configuração (prévia + posicionamento) | Shell largo de `frontend/src/pages/equipamentos/EquipamentosPage.tsx` | `Button`, `Modal`, tokens; área da página com `overflow: auto` própria | Lista de assinantes com `field-group`, `aria-invalid` e mensagem `.field-error` | Reordenação de lista: **N/A** (ordem = ordem de cadastro). O arraste do **campo sobre o documento** não é reordenação: usa Pointer Events com `touch-action: none`, funciona no toque e cancela sem persistir | `?doc=<id>&page=<n>` | Passo do tutorial permanente | Página do documento escalada pela largura do contêiner; rolagem interna própria; sem rolagem horizontal da página em nenhuma largura |
| Confirmação/publicação | `ConfirmDialog` do kit | `Modal`, `ConfirmDialog`, `Button` | `select` de validade com os estados do kit; data específica com o padrão de campo do app | N/A | Modal, sem estado em URL | Passo do tutorial permanente | Rodapé de ações fixo; lista de pendências rolável |
| Detalhes do documento | Blocos `det-section`/`det-row` de `frontend/src/pages/ReportDetailPage.tsx` | `det-section`, `det-row`, `Button`, `ConfirmDialog`, `Toast` | N/A | N/A | `?doc=<id>&tab=assinantes\|auditoria` | Passo do tutorial permanente | Tabela de assinantes vira cards em telas estreitas; histórico em cards; valores longos quebram ou truncam |
| Assinatura pública | `frontend/src/pages/PublicSignaturePage.tsx` e `frontend/src/pages/epi/EpiPublicSignaturePage.tsx` | **`SignatureDialog` reutilizado sem fork**, `PrivacyNotice`, shell `survey-page-shell` | Validação de nome do signatário já coberta pelo `SignatureDialog` | N/A | Fragmento capturado e removido na carga; token mantido só em memória | N/A — público externo não recebe tutorial | Shell público já responsivo; prévia do documento com rolagem interna |
| Verificação pública | `frontend/src/pages/SignatureValidationPage.tsx` | Página existente parametrizada para aceitar as duas origens | N/A | N/A | N/A | N/A | Já responsiva |
| Confirmação de exclusão de conta | `frontend/src/pages/admin/AdminAccountsPage.tsx` | `ConfirmDialog`, `Button` | N/A | N/A | N/A | N/A — tela administrativa existente | Texto de impacto quebra sem alargar o modal |

**Auditoria da fonte reutilizada**: `SignatureDialog.tsx`, `PdfDropzone.tsx`, `Modal`, `ConfirmDialog` e
`PrivacyNotice` foram inspecionados e estão aderentes à constitution vigente (tokens, estados de campo,
comportamento mobile). Nenhuma tarefa de correção da fonte é necessária.

### Key Entities

- **Documento de assinatura**: um PDF enviado por um usuário para coleta de assinaturas. Pertence a exatamente
  um proprietário enquanto a conta existir e preserva um registro histórico do nome de quem solicitou. Guarda o nome
  exibido, o nome do arquivo original, o tamanho, o número de páginas, a situação, as datas do ciclo de vida,
  o arquivo original, o arquivo final assinado e o código de verificação. Pode estar finalizando, arquivado
  e/ou excluído sem perder assinaturas já registradas.
- **Assinante**: uma pessoa que deve assinar um documento. Guarda nome (obrigatório), e-mail (opcional),
  ordem de exibição, situação, o convite individual (com validade e situação de entrega do e-mail) e, após a
  assinatura, as evidências: nome declarado no ato, imagem da assinatura, data e hora, origem do acesso e a
  versão do aviso de privacidade aceito. Pertence a exatamente um documento.
- **Campo de assinatura**: a área do documento onde um assinante específico deve assinar. Guarda a página e a
  posição de forma independente de tela, além do referencial da página no momento da marcação. Pertence a um
  documento e a um assinante.
- **Evento de histórico**: um registro somente-adição do que aconteceu com um documento. Guarda o tipo de
  evento, quando ocorreu, quem o originou (usuário interno, assinante externo ou rotina automática) e as
  evidências de origem do acesso quando aplicável. Pertence a um documento e, opcionalmente, a um assinante.
  A identidade, a ação e a data permanecem imutáveis; dados de rede podem ser anonimizados pelo processo de
  privacidade sem apagar o evento.
- **Notificação de conclusão**: registro durável criado junto com a conclusão do documento. Guarda destinatário
  histórico, chave idempotente, tentativas e resultado do provedor para que uma queda não perca o aviso nem
  provoque reenvio automático quando o resultado anterior for desconhecido.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Um usuário que já conhece o módulo consegue enviar um PDF, cadastrar dois assinantes, posicionar
  os campos e publicar a solicitação em menos de 3 minutos.
- **SC-002**: Um assinante externo que recebe o link consegue assinar em menos de 1 minuto, sem criar conta e
  sem instalar nada.
- **SC-003**: 100% das tentativas de acesso a documento de outro usuário são negadas, em todas as operações do
  módulo, sem revelar a existência do documento.
- **SC-004**: Em condições saudáveis do provedor, 100% dos convites de assinantes com e-mail são aceitos para
  entrega; 0% dos cadastrados sem e-mail geram tentativa de envio. Falhas ficam visíveis e recebem novas
  tentativas automáticas.
- **SC-005**: Indisponibilidade do serviço de e-mail não impede nenhuma publicação nem invalida nenhum link.
- **SC-006**: A posição das assinaturas no documento final corresponde ao que foi marcado na prévia em 100%
  dos casos, verificada em telas de celular, tablet e desktop e em páginas rotacionadas em 0°, 90°, 180° e
  270°.
- **SC-007**: Nenhuma tentativa de assinatura duplicada — por duplo clique, recarregamento ou reenvio — produz
  mais de uma assinatura registrada.
- **SC-008**: Um link revogado, renovado ou pertencente a documento excluído deixa de funcionar imediatamente,
  em 100% dos casos.
- **SC-009**: 100% dos eventos do ciclo de vida de um documento aparecem no histórico, e nenhum registro
  operacional, captura de erro, proxy, telemetria ou auditoria contém o link de assinatura.
- **SC-010**: Arquivar um documento concluído nunca altera sua situação nem invalida suas assinaturas.
- **SC-011**: Nenhuma tela do módulo produz rolagem horizontal de página em um celular de 360 px de largura.
- **SC-012**: A prévia de uma página do documento aparece para o usuário em até 2 segundos na primeira
  exibição e em até 250 ms nas seguintes, medidos no percentil 95 no ambiente de validação.
- **SC-013**: Um documento de até 30 páginas com até 10 assinantes tem seu arquivo final disponível em até 5
  segundos após a última assinatura.
- **SC-014**: Um terceiro que receba o documento final consegue conferir sua autenticidade sem conta e sem
  contato com a empresa.
- **SC-015**: A exclusão de uma conta nunca apaga um documento concluído, sempre informa a contagem exata do
  impacto antes da confirmação e torna inacessíveis imediatamente todos os arquivos dos documentos removidos.

## Assumptions

- **Público**: usuários internos da empresa, com a permissão concedida caso a caso pelo administrador do hub.
  Assinantes externos não têm e não terão conta na aplicação.
- **Reuso da infraestrutura de assinatura existente**: a aplicação já possui mecanismo interno de assinatura
  (geração e validação de links individuais, captura da assinatura, evidências, geração de documento assinado
  e trilha de auditoria) usado pelos módulos de relatórios e de EPI. Este módulo reutiliza essa infraestrutura
  em vez de criar uma segunda.
- **Assinatura eletrônica simples**: o padrão adotado é o mesmo já praticado pela aplicação — assinatura
  desenhada ou enviada como imagem, acompanhada de evidências de data/hora e origem do acesso. Certificado
  digital ICP-Brasil está fora de escopo.
- **Ordem das assinaturas**: paralela. Assinatura sequencial (um assinante só é convidado após o anterior
  concluir) fica como evolução futura, fora do MVP.
- **Um campo por assinante é suficiente para o MVP**, embora o modelo já suporte mais de um sem alteração
  estrutural.
- **Limites operacionais**: até 20 MB e 50 páginas por documento, até 20 assinantes por documento, validade
  máxima de convite de 90 dias — todos configuráveis pelo operador.
- **Fuso horário**: as datas são apresentadas no horário de Brasília (`America/Sao_Paulo`), fixado explicitamente, para que a hora exibida na tela seja idêntica à impressa no documento assinado, inclusive para quem acessar de outro fuso.
- **Idioma**: toda a interface, incluindo as páginas públicas vistas por assinantes externos, em pt-BR.
- **Privacidade**: aplica-se a política de privacidade já vigente na aplicação. O tratamento de nome e e-mail
  de assinantes externos e das evidências de acesso segue o que já é praticado nos fluxos de assinatura
  existentes; cabe ao responsável por privacidade registrar a operação no inventário antes do go-live.
- **Busca por nome** na listagem faz parte do MVP (o componente de busca já existe no kit da aplicação). O **filtro por situação** acompanha a organização do acervo, na história de prioridade P4.
- **Documento sem vínculo com projeto**: diferentemente dos relatórios, um documento avulso não pertence a
  nenhum projeto, obra ou cliente. Essa é a razão de ser do módulo.
