# Feature Specification: Databook por etapa do projeto

**Feature Branch**: `feat/project-databook`
**Created**: 2026-10-08
**Status**: Implemented and validated; awaiting manual rollout
**Input**: Automatizar o modelo construído a partir dos relatórios em produção do projeto 5815, permitindo escolher datas inicial e final, com padrão no primeiro e último RDO, para entregas por etapa.

## User Scenarios & Testing

### User Story 1 — Preparar uma etapa (P1)

Um gestor abre o databook de um projeto ativo ou arquivado, identifica a etapa e escolhe seu período. O primeiro e o último RDO não excluídos fornecem as datas iniciais; edições do usuário permanecem intactas. O intervalo inclui ambas as pontas e filtra relatórios pela data operacional, independentemente do fuso horário. Pode excluir relatórios de outro escopo ocorrido nas mesmas datas.

**Independent Test**: Preparar duas etapas independentes de 5815 usando o inventário de produção já coletado, incluindo relatórios exatamente nas datas inicial e final.

**Acceptance Scenarios**:
1. Dado um projeto com 22 RDOs de 16/09 a 07/10, ao abrir, as datas são 16/09/2026 e 07/10/2026.
2. Dado um período de 17/09 a 20/09, entram relatórios nessas duas datas e nenhum de 16/09 ou 21/09.
3. Dado um período inválido ou sem relatórios, a emissão falha com informação específica, sem criar pacote completo.
4. Dado um projeto sem RDO, as datas ficam vazias e podem ser informadas manualmente.

### User Story 2 — Conferir evidências e emitir (P1)

O gestor seleciona relatórios, fotos com legendas e ordem, documentos técnicos e produtos comprovadamente utilizados. Movimentação de estoque é apresentada como origem candidata, sem afirmar consumo. Cada produto confirmado exige escolha explícita da FDS e conferência de correspondência/revisão. Uma emissão produz PDF consolidado e ZIP com os arquivos originais, manifesto e hashes.

**Independent Test**: Gerar pacote com relatórios e FDS reais copiados de produção; comparar os hashes dos PDFs originais no ZIP e validar todas as páginas da FDS no consolidado.

**Acceptance Scenarios**:
1. Fotos de relatórios excluídos não podem entrar; seleção e legenda não alteram originais.
2. Produto utilizado sem FDS conferida impede emissão; documento genérico não é classificado automaticamente como FDS.
3. Relatórios não aprovados impedem emissão se selecionados; falta de assinatura/aceite é informada sem afirmar aceite do cliente.
4. Arquivo obrigatório ausente faz a tarefa falhar, preservando possibilidade de tentar novamente.

### User Story 3 — Acompanhar e preservar revisões (P2)

Geração ocorre em tarefa persistida, com progresso, erro e repetição. Pacotes concluídos são imutáveis. Uma nova revisão mantém a anterior e permite corrigir seleção; outra etapa tem identidade independente. Usuários de consulta podem consultar/baixar conforme alcance, mas não emitir. O cliente não recebe publicação automática.

**Independent Test**: Emitir revisão 1 e 2 da mesma etapa, baixar a primeira depois da segunda e verificar bytes/hash inalterados; testar autorização no backend e concorrência da fila.

### Edge Cases

- Datas reais, inclusive anos bissextos; endDate menor que startDate; datas fora dos RDOs permitidas quando há relatórios.
- Projeto arquivado pode emitir; excluído não. Etapas simultâneas/sobrepostas são permitidas.
- ReportAttachment pode estar no serviço ou relatório; uploads legados em JSON também devem ser considerados.
- FDS antiga não é excluída por sua data de upload. Documentos externos são registrados como referências, sem download externo automático.
- Seleções adulteradas de outro projeto/produto, fotos fora do período, documentos comerciais e paths arbitrários são rejeitados.
- Reinício/reclamação de tarefa não permite que trabalhador antigo finalize uma emissão reclamada.

## Requirements

- **FR-001**: Datas padrão calculadas sobre todos os RDOs não excluídos, usando datas UTC operacionais; período obrigatório e inclusivo.
- **FR-002**: Etapa/nome, resumo técnico e seleção explícita de relatórios, fotos, produtos/FDS e documentos técnicos.
- **FR-003**: PDF com capa, controle da revisão, período, identificação, resumo, índice de relatórios, serviços, fotos, produtos/FDS, documentos e pendências/estado de assinaturas.
- **FR-004**: Anexar PDFs completos de relatórios, FDS e documentos selecionados; preservar bytes originais no ZIP com manifesto SHA-256. Informar que junção PDF não preserva validação criptográfica dos originais.
- **FR-005**: Emissão persistida com estado/progresso/erro, repetição e artefatos privados; sem entregar parcial como concluído.
- **FR-006**: Histórico independente por etapa e revisões imutáveis; snapshot das fontes fica congelado após emissão.
- **FR-007**: Usar autorização explícita de gestores internos RDO/Efetivo/Acompanhamento; consultas internas conforme módulos e managerOnly; negar colaboradores e clientes nesta primeira entrega interna.
- **FR-008**: Não alterar relatórios, fotos, estoques ou fechamento do projeto pela curadoria. Reusar o downloader oficial para preservar PDFs assinados.
- **FR-009**: Sem publicação automática ou registro fictício de entrega/aceite. O pacote é baixado pelo usuário para entrega.

### Visual/UI Contract

| Surface | Existing reference inspected | Components/classes | Form/dropdown pattern | Reorder | Navigation | Novelty/tutorial | Responsive |
|---|---|---|---|---|---|---|---|
| Dialog de databook | ProjectDocumentForm, Modal, ProjectReportsDialog | Modal design-system, DS Button/Field/Input/Select/Alert/Skeleton; tokens | RHF/Zod, field-group/field-invalid e erro por campo | Handle Pointer Events, ghost, placeholder, cancel restore, setas | query param databook=projectId | Driver.js, janela de 08/10 a 18/10, chave por usuário | Modal com rodapé fixo, listas/cartões, textos quebráveis, sem overflow |
| Ações dos projetos | GestorPage, ProjectDetailDashboard, ProjectWorkflowModal | botão compartilhado do contexto | N/A | N/A | seleção do projeto na URL | botão marcado durante campanha | ações quebram em múltiplas linhas |

### Key Entities

- **ProjectDatabook**: uma emissão de uma etapa, revisão sequencial por família, período, opções/snapshot, autor, estado e arquivos/hash.
- **DatabookSources**: relatórios e fotos por período, estoque candidato e documentos de projeto elegíveis.

## Success Criteria

- **SC-001**: As duas datas padrão correspondem aos 22 RDOs do inventário real de 5815, sem usar fixtures locais como fonte factual do projeto.
- **SC-002**: Pacotes de duas etapas excluem integralmente fontes fora da seleção/período.
- **SC-003**: Todas as FDS selecionadas aparecem completas no PDF e intactas no ZIP.
- **SC-004**: Erros de arquivos, concorrência e autorização têm testes de backend e não expõem pacote parcial.
- **SC-005**: UI utilizável em tela estreita, com erros de campo acessíveis e consulta de progresso.

## Assumptions and Clarification Coverage

Não há ambiguidade crítica que exija resposta adicional: datas inclusivas e múltiplas etapas foram explicitamente solicitadas. Escopo, domínio, UX, autorização, falhas, contratos e critérios estão definidos. Esta entrega permite preparação e emissão interna; entrega/aceite continuam processos externos existentes. Calibrações e certificados entram como documentos técnicos selecionados quando cadastrados no projeto. Não inferir rastreabilidade de equipamentos não registrada. Evidência factual: inventário e arquivos já copiados de produção em output/playwright/databook-5815-producao; nenhum banco local é tratado como realidade do projeto.
