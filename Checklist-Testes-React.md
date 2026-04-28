# Checklist de testes manuais — Migração React

Use este checklist antes do cutover definitivo do HTML legado para o React.

## Pré-condições

- Backend rodando com migrations aplicadas.
- Frontend React apontando para a API correta.
- Usuários ativos para `COLLABORATOR`, `MANAGER`, `COORDINATOR` e `CLIENT`.
- Projetos ativo e arquivado com relatórios de exemplo.
- Pelo menos um RDO com serviços de limpeza, pressão, flushing, filtragem, mecânica e inibição.

## Público

- [ ] Login com credenciais válidas.
- [ ] Login com senha inválida exibe erro claro.
- [ ] Recuperação de senha envia solicitação.
- [ ] Link de redefinição abre `/reset-password`.
- [ ] Redefinição de senha conclui e permite novo login.

## Colaborador

- [ ] Home carrega projetos disponíveis.
- [ ] Novo RDO exige projeto, data, horários, equipe e ao menos um serviço.
- [ ] Pré-preenchimento de colaboradores do último relatório do projeto funciona.
- [ ] Continuação de serviços do último relatório importa serviços para o novo RDO.
- [ ] Upload de fotos gerais funciona.
- [ ] Upload por tipo de serviço funciona.
- [ ] Rascunho é salvo, listado, retomado e removido após envio.
- [ ] Envio de RDO cria relatório pendente.
- [ ] Meus relatórios agrupa por projeto e abre detalhe.
- [ ] Arquivados exibe relatórios de projetos arquivados.
- [ ] Conta altera e-mail/senha.

## Gestor

- [ ] Painel lista pendentes, aprovados e arquivados.
- [ ] Aprovar relatório gera derivados esperados.
- [ ] Devolver relatório exige motivo.
- [ ] Detalhe de RDO permite edição e salvamento.
- [ ] Download individual PDF funciona.
- [ ] Download individual DOCX funciona.
- [ ] Download em lote PDF gera ZIP.
- [ ] Download em lote DOCX gera ZIP.
- [ ] CRUD de projetos cria, edita, arquiva e desarquiva.
- [ ] CRUD de colaboradores cria, edita e desativa.
- [ ] CRUD de usuários cria, edita e desativa.
- [ ] CRUD de equipamentos cria, edita e desativa.
- [ ] CRUD de unidades cria, edita e desativa.
- [ ] CRUD de manômetros cria, edita e desativa.
- [ ] CRUD de contadores cria, edita e desativa.

## Coordenador

- [ ] Painel lista relatórios aprovados.
- [ ] Painel lista relatórios arquivados por projeto.
- [ ] Detalhe abre sem ações indevidas de gestor.
- [ ] Download PDF funciona.
- [ ] Download DOCX não aparece.
- [ ] Conta altera dados.

## Cliente

- [ ] Painel lista apenas relatórios visíveis para o cliente.
- [ ] Detalhe abre para RDO e derivados liberados.
- [ ] Download PDF individual funciona.
- [ ] Download em lote PDF gera ZIP.
- [ ] Solicitar assinatura individual abre link de assinatura.
- [ ] Solicitar assinatura em lote aceita apenas RDO aprovado do mesmo projeto.
- [ ] Reprovar relatório exige motivo.
- [ ] Relatório assinado aparece como assinado após retorno do webhook.

## Responsividade

- [ ] Login funciona em celular.
- [ ] Shell, topo e abas não sobrepõem conteúdo em celular.
- [ ] Cards de relatório cabem em 360 px de largura.
- [ ] Formulário de RDO pode ser preenchido em celular sem cortes horizontais.
- [ ] Modais de motivo cabem na tela e mantêm botões visíveis.

## Deploy

- [ ] `npm run build` do frontend passa.
- [ ] `docker compose -f docker-compose.prod.yml config` passa com `POSTGRES_PASSWORD` definido.
- [ ] Nginx serve `/` com React.
- [ ] Nginx reescreve rotas SPA, como `/cliente/relatorio/:id`.
- [ ] `/api/health` ou `/health` responde conforme esperado no ambiente.
- [ ] `/api` continua proxy para o backend.
- [ ] `/uploads` e `/relatorios` continuam proxy para o backend.
- [ ] `/legacy` abre o HTML antigo durante a janela de validação.
