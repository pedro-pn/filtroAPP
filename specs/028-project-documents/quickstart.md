# Quickstart: validar Documentos do projeto

Este guia será executado depois da implementação. Ele não contém comandos de servidor, Docker ou deploy.

## Prerequisites

- dependências do monorepo instaladas;
- banco local de desenvolvimento disponível conforme o fluxo atual do projeto;
- um projeto ativo com Gestão de Projetos iniciada;
- usuários de teste para Líder, Comercial, Operações e visualizador;
- um PDF pequeno válido e arquivos inválidos para testes negativos.

## Static and automated checks

Na raiz do repositório, executar os comandos locais definidos pelos `package.json` para:

1. formatar, validar e gerar o cliente Prisma;
2. executar os testes de documentos e as regressões do workflow no backend;
3. executar os testes de contrato da interface no frontend;
4. executar lint e build dos dois lados;
5. executar `git diff --check`.

Os nomes exatos dos comandos devem seguir os scripts existentes no momento da implementação e serão registrados na validação da entrega.

## Scenario 1 - MVP manual and versioning

1. Abra Evolução e mantenha o projeto aberto pelo parâmetro de URL.
2. Expanda “Documentos do projeto”.
3. Cadastre uma proposta técnica manual com PDF, responsável e `Rev. 00`.
4. Baixe a versão vigente e confira nome e conteúdo.
5. Inclua `Rev. 01`.
6. Recarregue a página.

Expected: `Rev. 01` é vigente; `Rev. 00` permanece no histórico; o arquivo abre por rota autenticada; o caminho físico não aparece na resposta.

## Scenario 2 - Acceptance and gate

1. Configure um contrato como obrigatório para mobilização e com aceite do cliente.
2. Anexe a primeira versão sem registrar aceite.
3. Tente avançar/mobilizar.
4. Registre aceite da versão e repita.
5. Com a autorização emitida, anexe nova versão.

Expected: antes do aceite, o bloqueio nomeia contrato e ação; após aceite, ele libera esse requisito; a nova versão volta a pendente e invalida a autorização anterior sem mover o card.

## Scenario 3 - Backward compatibility

1. Use um projeto legado ou ativo sem documentos/requisitos cadastrados.
2. Calcule o gate e execute o fluxo que já era permitido.

Expected: nenhum requisito documental implícito aparece e o comportamento anterior é preservado.

## Scenario 4 - Permissions and closed project

1. Como Comercial, gerencie proposta comercial e tente alterar desenho técnico.
2. Como Operações, faça o inverso.
3. Como visualizador, tente incluir e baixar um arquivo de projeto visível.
4. Tente acessar o arquivo com usuário sem acesso ao projeto.
5. Encerre o projeto e tente alterar um documento.

Expected: cada área altera somente seus tipos; visualizador autorizado consulta sem editar; usuário sem visibilidade não acessa o arquivo; projeto encerrado fica somente leitura.

## Scenario 5 - Files and rollback

1. Envie arquivo acima do limite, extensão não aceita, MIME divergente, conteúdo inválido e nome com tentativa de caminho.
2. Simule falha de banco após escrita do arquivo.

Expected: entradas inválidas são recusadas; nenhum caminho escapa do diretório gerenciado; a falha remove o arquivo não associado.

## Scenario 6 - Signatures

1. Configure um PDF com modo de aceite por assinatura.
2. Use “Preparar assinatura”.
3. Configure e conclua o documento pelo módulo Assinaturas.
4. Volte/recarregue o projeto.

Expected: o deep link abre o documento correto; o projeto reflete o estado da assinatura e oferece o PDF final; não há segunda lista de signatários ou auditoria.

## Scenario 7 - Operational documents

1. Gere RDO e relatório técnico para o projeto pelos fluxos existentes.
2. Abra a categoria documental.

Expected: ambos aparecem com o estado atual e link autorizado; nenhum registro duplicado é criado no catálogo.

## Scenario 8 - CRM adapter readiness

1. Chame o adaptador interno com uma referência externa nova.
2. Repita a mesma entrada.
3. Envie versão mais antiga e depois mais nova.
4. Tente editar a versão CRM pela API de usuário.

Expected: criação única, replay idempotente, versão antiga ignorada, versão nova vigente e mutação manual recusada. Nenhum status comercial é confirmado implicitamente.

## Responsive and visual evidence

Validar o diálogo em desktop e em uma viewport estreita representativa dos celulares de campo. Confirmar corpo rolável, rodapé fixo, categoria recolhível, campos empilhados, erros específicos em vermelho, nomes longos tratados e ausência de rolagem horizontal da página. Validar também a campanha/tutorial antes e depois da expiração global de 10 dias.
