# Briefing de requisitos — Módulo de Assinaturas Avulsas

> **Origem**: prompt do solicitante em 2026-08-21, invocando `/speckit-plan` diretamente (esta feature **não**
> passou por `/speckit-specify` nem `/speckit-clarify`). Este arquivo é o índice normativo das 33 seções do
> briefing, preservado para rastreabilidade. O texto integral original está no histórico da conversa; aqui
> ficam os requisitos em forma verificável, sem acréscimo nem supressão de obrigações.

---

## 1. Objetivo
Módulo que permite a um usuário da aplicação subir um PDF avulso e solicitar assinaturas, usando o mecanismo
interno de assinatura já existente. Fluxo: upload → prévia → cadastro de assinantes → posicionamento dos campos
→ validade dos links → validação/publicação → geração dos links individuais → notificações quando houver e-mail
→ acompanhamento → documento final assinado + trilha de auditoria.

## 2. Investigação prévia obrigatória
Antes de propor solução, mapear: sistema atual de assinaturas; models/tabelas de documentos, assinaturas,
signatários e auditoria; serviços de assinatura; armazenamento de PDFs; upload/download; geração e validação de
token/hash; expiração; páginas públicas; visualização de PDF; posicionamento de campos; aplicação/finalização da
assinatura; auditoria; e-mail; filas/jobs; permissões; padrões de autorização e isolamento; soft
delete/arquivamento; storage e abstrações; testes existentes. Classificar cada peça como (1) reutilizar direto,
(2) estender, (3) adaptar, (4) criar. **Prioridade: reutilizar e não duplicar regra de assinatura.**

## 3. Permissão
**Uma única** permissão de acesso, sem distinção funcional (gestor/colaborador/admin). Quem a tem usa o módulo;
quem não a tem não acessa páginas nem endpoints autenticados. Seguir a nomenclatura de permissões do projeto.

## 4. Isolamento e propriedade (crítico)
Cada documento pertence exclusivamente ao usuário que fez o upload (`owner_user_id` ou equivalente). Um usuário
**não** pode ver ou manipular documento de outro, mesmo com mesma empresa, mesma função, mesma permissão, sendo
gestor, ou conhecendo o ID. Isolamento **no backend**, não só na interface. Vale para: listagem, visualização,
detalhes, PDF original, PDF final, assinantes, auditoria, geração/cópia de links, renovação, arquivamento,
restauração, exclusão e download. Analisar IDOR/BOLA. Assinantes externos acessam **somente** o fluxo público do
próprio token.

## 5. Upload
Upload de PDF reaproveitando o mecanismo de upload/storage existente. Validar de forma segura que é realmente um
PDF; respeitar limites da aplicação ou propor limites configuráveis. Documento inicia como rascunho/configuração.
Preservar: documento original, documento final, nome original, tamanho, número de páginas, timestamps,
proprietário e status. Não inventar armazenamento paralelo.

## 6. Pré-visualização e posicionamento
Prévia navegável do PDF. Usuário seleciona onde cada assinante assina. Cada campo explicitamente associado a um
assinante. Posição **não** pode depender de pixels da tela: representação estável com página, X, Y, largura,
altura, referencial e identificador do assinante. Preferir coordenadas normalizadas ou o padrão já usado.
Posicionamento correto em diferentes tamanhos de tela e re-renderizações. Se já houver componente de
posicionamento, reutilizar.

## 7. Cadastro dos assinantes
Um ou mais assinantes. Por assinante: **nome obrigatório**, **e-mail opcional**, campo/posição correspondente e,
depois, link exclusivo. Avaliar se o próprio uploader pode ser assinante (indicar se simples; sinalizar
separadamente se aumentar escopo). **Não** implementar cadastro de usuário para assinantes externos.

## 8. Ordem das assinaturas
MVP em paralelo, salvo se o mecanismo atual obrigar outra coisa. Sequencial só como possibilidade futura, sem
aumentar o escopo do MVP.

## 9. Publicação/validação
Antes de publicar validar: PDF válido e disponível; ≥1 assinante; todos com nome; campos obrigatórios
posicionados; cada campo vinculado ao assinante correto; prazo de expiração válido. Só depois publicar e gerar
os links. PDF, assinantes e posições não podem mudar silenciosamente após a publicação. Se for necessário mudar
estruturalmente, preferir cancelar/inutilizar a rodada e gerar nova versão/processo, invalidando links antigos.

## 10. Links de assinatura
Link exclusivo por assinante. **Não** pode se basear apenas em ID incremental, UUID exposto, e-mail, ID do
documento ou combinação previsível. Reaproveitar o mecanismo seguro de token/hash existente. Cada convite
associado inequivocamente a documento, assinante, token, validade, status e timestamps. Entropia suficiente.
**Não** introduzir criptografia própria se já existir mecanismo confiável.

## 11. Validade e expiração
Quem faz o upload escolhe o prazo antes da publicação (opções pré-definidas e/ou data/hora). Timezone conforme a
convenção do sistema. Link expirado: não permite assinar, mostra mensagem adequada, permite ao dono
renovar/reemitir. Ao renovar: novo token seguro, invalidação do anterior, registro em auditoria. Definir se a
expiração é por convite ou por rodada, com justificativa.

## 12. Exibição/cópia manual dos links
Após publicar, a tela do dono lista os assinantes e permite copiar o link individual (WhatsApp, Slack etc.).
Considerar a segurança do armazenamento dos tokens; analisar como o sistema atual trata isso. Se armazenar token
recuperável for inadequado, propor mecanismo seguro que ainda permita copiar/reemitir. **Explicar a decisão.**

## 13. Notificação por e-mail
Assinante com e-mail recebe convite com link individual após a publicação. Assinante sem e-mail: link é criado,
**nenhuma tentativa de envio ocorre**, o dono copia manualmente. Reutilizar obrigatoriamente a infraestrutura de
e-mail/templates/jobs. Auditar envio solicitado, envio realizado e falha. **Falha de e-mail não pode corromper o
processo nem impedir a cópia manual.** Avaliar retry.

## 14. Fluxo do assinante
O link dá acesso apenas ao documento/experiência do próprio convite. Backend valida: existência do convite,
token, expiração, documento, assinante, status atual e cancelamento/revogação. Reutilizar a experiência pública
existente. O assinante deve: visualizar, localizar seu campo, assinar com o mecanismo existente, confirmar e
receber feedback. **Não** criar um segundo mecanismo de assinatura.

## 15. Status do assinante
Representar ao menos: pendente, visualizado (se já rastreado), assinado, expirado, cancelado/revogado.
A interface do dono mostra nome, e-mail quando houver, situação, data/hora da assinatura e acesso/cópia do link
enquanto aplicável.

## 16. Status do documento
Situação global clara: Rascunho, Aguardando assinaturas, Concluído, Expirado (quando aplicável), Cancelado (se o
modelo contemplar). **Arquivado** deve ser atributo/estado de organização, não alterando o significado jurídico
do status. Listagem pode mostrar progresso ("2 de 4 assinaturas"). Não criar status deriváveis dos signatários.

## 17. Finalização
Concluídas todas as assinaturas necessárias: marcar como concluído, usar o mecanismo atual para gerar/finalizar
o PDF assinado, preservar o arquivo final e as evidências/auditoria, e permitir download **somente ao
proprietário** pela área autenticada. Reaproveitar certificados/carimbos/hashes/páginas de auditoria existentes.
**Não** reimplementar essa lógica.

## 18. Listagem
Cards (ou formato coerente com o design atual) com: nome do documento, data de criação, status, progresso,
quantidade de assinantes e indicação de conclusão. Detalhes com: preview/informações do PDF, lista de
assinantes, status individual, data/hora das assinaturas, links/copiar quando permitido, expiração, trilha de
auditoria, download do PDF original/final conforme as regras e ações disponíveis. Filtros por status e busca por
nome são melhoria de UX se não couberem facilmente nos componentes existentes.

## 19. Auditoria
Trilha confiável, preferencialmente append-only, reaproveitando a estrutura existente. Eventos: documento
criado/upload, configuração concluída, publicado, convite criado, e-mail solicitado, e-mail enviado, falha de
e-mail, link acessado, documento visualizado, assinatura realizada, convite expirado, renovado, revogado,
documento concluído, PDF final gerado, arquivado, restaurado, excluído. Preservar evidências já usadas pelo
sistema (timestamp, IP, user-agent, id do convite, id do assinante, hashes). **Não** criar segunda estrutura de
auditoria incompatível.

## 20. Arquivamento
O dono pode arquivar: remove da listagem principal, mantém em área de arquivados, preserva documento,
assinaturas e auditoria, e permite restauração. Arquivar documento concluído **não** altera nem invalida
assinaturas. Reutilizar o padrão de arquivamento do sistema.

## 21. Exclusão
Investigar como o projeto trata exclusões; preferir soft delete/trash se for o padrão. Explicar o comportamento
para rascunhos, aguardando assinatura e concluídos; o que acontece com links ativos, arquivos físicos e
auditoria; e se haverá retenção antes da exclusão definitiva. **Qualquer exclusão invalida imediatamente os
links públicos ativos.** Confirmação explícita na interface.

## 22. Imutabilidade e integridade
Depois que alguém assina, não pode ser possível substituir silenciosamente PDF, posição, conteúdo, identidade do
assinante ou evidências. Planejar como a solução atual garante integridade e como reutilizá-la. PDF final e
registros concluídos tratados de forma consistente com o sistema atual.

## 23. Concorrência e idempotência
Considerar: dois requests registrando a mesma assinatura; clique duplo; retries; dois processos finalizando o
documento; job de e-mail executado mais de uma vez; renovação de link concomitante a tentativa de assinatura.
Identificar onde são necessárias transactions, locks, unique constraints, idempotência e validações atômicas.
**Não** supor que a interface evita esses casos.

## 24. Segurança
Análise explícita cobrindo: autorização por owner; IDOR/BOLA; tokens; expiração; revogação; replay; acesso ao
storage; URLs temporárias; validação de PDF; upload malicioso; limites de tamanho; rate limiting das rotas
públicas; proteção das informações dos demais assinantes; logs sem vazamento de token; tratamento de token no
frontend; cache de páginas públicas; CSRF/CORS. **Nunca** registrar o token completo em logs. **Não** expor a um
assinante externo informação desnecessária sobre os demais.

## 25. Privacidade
Verificar a abordagem atual de privacidade/LGPD e armazenamento de documentos. Não criar políticas novas sem
necessidade, mas identificar impactos: nome e e-mail de assinantes externos; IP/user-agent; retenção de
documentos; exclusão; logs; backups. Sinalizar decisões de produto necessárias.

## 26. Migração e compatibilidade
O módulo não pode quebrar o sistema atual. Planejar migrations, novos relacionamentos, alterações em models
existentes, novos tipos/origens de documento e compatibilidade com registros existentes. Avaliar
`source`/`origin`/`document_type`/entidade pai **antes** de criar tabelas paralelas; não forçar esse modelo se a
arquitetura indicar solução melhor.

## 27. API/backend
Listar endpoints/actions/use-cases com finalidade, autenticação, autorização, entrada, saída, entidade/serviço e
validações. Separar claramente endpoints autenticados do proprietário e públicos do assinante externo.

## 28. Frontend
Descrever telas/componentes e reaproveitamentos: Listagem; Novo documento; Configuração; Confirmação/publicação;
Detalhes; Assinatura pública (reutilizar a existente). Considerar loading, empty states, erros, upload em
andamento, falha de e-mail, link expirado e documento inexistente.

## 29. E-mail
Identificar o template/infra mais apropriado. O conteúdo informa: que há documento aguardando assinatura;
identificação segura do documento; remetente/solicitante; botão/link de assinatura; data de expiração.
**Não** enviar e-mail para assinante sem endereço.

## 30. Observabilidade
Logs e métricas úteis sem dado sensível: falha de upload, falha de processamento, falha na geração do PDF final,
falha de e-mail, token inválido/expirado em formato agregado, duração de processamento. **Token completo nunca
em log.**

## 31. Testes
Estratégia detalhada (unitário, integração e/ou E2E conforme os padrões existentes) cobrindo obrigatoriamente:
acesso sem/com permissão; A não vê nem acessa documento de B (inclusive por endpoint direto); upload válido;
rejeição de arquivo inválido; assinante com e sem e-mail; posicionamento; publicação; links distintos; e-mail só
quando houver endereço; assinatura válida; token incorreto/expirado/revogado; renovação invalidando o anterior;
dupla assinatura; progresso parcial; conclusão após a última assinatura; geração do PDF final; auditoria;
arquivamento; restauração; exclusão; invalidação de links após exclusão/cancelamento; isolamento de
storage/download; condições de corrida.

## 32. Formato da resposta
Seções A–P: A. Resumo da arquitetura atual · B. Inventário de código existente (tabela) · C. Gap analysis
(já existe / pequena adaptação / estender / criar) · D. Decisões de arquitetura · E. Modelo de dados ·
F. Estados e transições · G. Segurança e autorização · H. Backend · I. Frontend · J. Fluxo completo ·
K. Auditoria · L. Migrations · M. Estratégia de testes · N. Plano de implementação em etapas pequenas ·
O. Riscos · P. Decisões de produto em aberto (só o que não puder ser deduzido, com recomendação primeiro).

## 33. Restrições
Não implementar ainda; não criar sistema paralelo de assinatura sem investigar o existente; não duplicar código
reutilizável; não alterar comportamento de módulos existentes sem justificar; não fazer autorização apenas no
frontend; não permitir acesso cruzado entre usuários; não usar IDs previsíveis como autorização; não registrar
tokens em log; não confundir arquivamento com exclusão; não modificar silenciosamente documentos enviados ou
assinados; não fazer refactors amplos desnecessários; seguir padrões, convenções, lint, testes e organização do
repositório; quando houver mais de uma solução, preferir a que exige menos código novo e melhor reutiliza a
infraestrutura de assinatura atual.
