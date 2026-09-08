# Testar API por permissão implementada — 2026-09-08

O painel torna testáveis as 33 permissões existentes por meio das 35 operações externas já implementadas. Não cria consultas arbitrárias, novos escopos, novas rotas externas ou acesso a modelos futuros.

- Selecionar credencial, permissão e operação. A busca de permissão inclui domínio, nome e código; selecionar uma permissão filtra operações obrigatórias ou opcionais correspondentes. Uma permissão não concedida continua visível para entendimento, mas impede execução; não amplia o token.
- `GET /admin/api-scopes` publica metadados de todas as operações: domínio, escopos obrigatórios/opcionais, tipo de resposta e descritores de cada parâmetro (nome, localização, tipo, rótulo, ajuda, limites, opções e permissão adicional quando necessária).
- UI renderiza esses descritores, com RHF + Zod e erros por campo. Listagens não exigem ID individual. Consulta de Qualidade pede ID do registro de Qualidade; downloads pedem ID da evidência, anexo ou documento correto, com indicação de onde copiá-lo. Filtros de projeto, relatório, manutenção e item continuam opcionais onde contratados.
- Todos os filtros implementados são acessíveis, inclusive cursor/snapshot, filtros de Qualidade e estado ativo. Datas locais são convertidas para ISO; filtros desconhecidos e valores inválidos são rejeitados no backend antes de dados/cotas. `includeDeleted=false` não exige o escopo de excluídos.
- Trocar operação, permissão ou credencial limpa resposta/parâmetros incompatíveis. Somente permissão/operação/etapa persistem na URL; nunca ID de registro, corpo, resultado ou segredo. Selecionar excluídos prepara `includeDeleted=true` somente se concedido.
- Downloads são testados como `DOWNLOAD_CHECK`: validar escopos/projeto/publicação e abrir/fechar o arquivo gerenciado para verificar disponibilidade. Retornar JSON com id, MIME, tamanho e aviso; não transmitir arquivo original, base64, caminho, URL pública ou segredo. Respeitar os limites de arquivo existentes e medir apenas o JSON devolvido na cota do teste. Copiar cURL produz o GET externo com variável de token e arquivo de saída, para o consumidor validar o download real.
- O executor administrativo continua sob sessão ADMIN, sem recuperar o token. Estado/validade, escopos, projetos, cotas e evento TESTED são aplicados. IP e autenticação Bearer do consumidor não são comprovados pela simulação e isso fica explícito na tela.
- Contratos anteriores que excluíam downloads do console são estendidos somente por essa verificação JSON; download binário permanece exclusivamente no endpoint externo. Sem alteração Prisma, migração ou deploy.

A verificação de arquivos limita-se a 50 MiB para os quatro downloads. O cURL utiliza `FILTRO_API_BASE_URL` (origem do app, sem barra final) e `FILTRO_API_TOKEN`, definidos pelo consumidor no terminal; não emite comando com caminho relativo sem host.

Aceite: todos os escopos disponíveis têm operação testável; todos os parâmetros têm descritores; testes de dispatch de consultas e dos quatro downloads, negação de escopo/estado/projeto/arquivo inválido, ausência de segredos e validação de UI com credencial limitada e telas estreitas.
