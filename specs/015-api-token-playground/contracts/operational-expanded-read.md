# Relatórios, estoque e manutenção — incremento autorizado em 2026-09-08

Somente GET, Bearer de integração, credenciais administradas por admin. Este incremento publica os 16 candidatos restantes desses três grupos, sem habilitar outros domínios. Reutiliza cotas, revogação, expiração, auditoria, restrições de IP e projetos existentes; não altera o banco.

## Coleções e dependências

Base `/api/integracoes/v1`. Cada permissão abaixo requer também a permissão-base do grupo: `rdo.relatorios.read`, `estoque.itens.read` ou `manutencao.registros.read`.

| Caminho | Permissão | Dados públicos |
|---|---|---|
| `/rdo/versoes` | `rdo.versoes.read` | versão, situação, relatório e criação; sem PDFs, hashes ou códigos de validação |
| `/rdo/equipe` | `rdo.equipe.read` | IDs de relatório/colaborador e cargo registrado; sem contatos |
| `/rdo/servicos` | `rdo.servicos.read` | serviço, equipamento, material, horários e conclusão; sem JSON livre |
| `/rdo/anexos` | `rdo.anexos.metadata.read` | identificação, nome, MIME e criação; sem caminhos/URLs |
| `/rdo/assinaturas` | `rdo.assinaturas.read` | papel, tipo, situação e datas; sem identidade, imagem ou prova criptográfica |
| `/rdo/auditoria` | `rdo.auditoria.read` | ação, data, relatório/versão; sem ator, texto livre, IP ou user-agent |
| `/estoque/lotes` | `estoque.lotes.read` | item, lote e validade; sem fornecedor/NF |
| `/estoque/movimentos` | `estoque.movimentos.read` | item, lote, projeto, tipo, motivo, quantidade e data; sem custos |
| `/estoque/documentos` | `estoque.documentos.metadata.read` | item, nome, MIME e criação; cadastro global |
| `/estoque/custos` | `estoque.custos.read` | projeção financeira de movimentos; custo unitário decimal como string |
| `/manutencao/terceiros` | `manutencao.terceiros.read` | serviço, local, data e descrição operacional |
| `/manutencao/anexos` | `manutencao.anexos.metadata.read` | manutenção, tipo, nome, MIME e criação |
| `/manutencao/auditoria` | `manutencao.auditoria.read` | transições de situação e data; sem ator ou observações |

Custos também requerem `estoque.movimentos.read`. Downloads GET em `/rdo/anexos/{id}/download`, `/estoque/documentos/{id}/download` e `/manutencao/anexos/{id}/download` requerem base + metadados + o respectivo escopo `.download`. O console verifica acesso/disponibilidade com JSON conforme `generic-playground.md`; não transfere arquivo. O arquivo original pode conter dados pessoais/financeiros: conceder download exige avaliar seu conteúdo, não apenas os metadados.

## Visibilidade e arquivos

Relatórios devem estar `APPROVED`, não excluídos e com projeto não excluído. Versões `DRAFT` não são publicadas. Anexos órfãos são excluídos; quando possuem dois pais, ambos devem ser autorizados. Manutenções precisam estar aprovadas; avulsas somente com todos os projetos. Auditoria de manutenção não publica eventos sem manutenção. Movimentos sem projeto somente com todos os projetos; lotes em acesso selecionado exigem movimento em projeto autorizado. Documentos técnicos de estoque são globais, explicitamente indicados na UI.

Download consulta o registro com a mesma política da listagem antes de abrir arquivo. Arquivos RDO exigem pasta pertencente ao projeto do relatório (o índice de anexos não é prova de propriedade). Somente armazenamento local gerenciado: sem redirects ou fetch de URLs, sem travessia, symlinks ou arquivos fora das pastas permitidas. Documentos legados FISPQ são resolvidos internamente sem publicar tokens. Limite de 50 MiB por arquivo; resposta attachment/no-store/nosniff, erros sem caminhos. Bytes e requisições entram na medição existente; não é criada uma cota diária de bytes.

## Paginação e filtros

Na auditoria de download, bytes representam o tamanho autorizado/preparado do arquivo; não são confirmação de recebimento integral pelo consumidor. A reserva e o registro acontecem antes do envio do stream, como no download de Qualidade existente.

Envelope e cursor assinado compatíveis com as coleções existentes. `limit`, `cursor`, `snapshotAt` em todas; `projectId` onde há vínculo; `reportId`, `maintenanceId` ou `itemId` somente nas coleções correspondentes. `updatedSince` apenas onde existe `updatedAt`; registros com apenas `createdAt` aceitam `createdSince` e ordenam `(createdAt,id)`. Equipe ordena `(reportId,collaboratorId)`, sem data inventada e sem filtro incremental. O teto de equipe aplica-se à criação do relatório pai.

Snapshot é um teto temporal de consulta, não isolamento transacional entre páginas. Criações, edições, exclusões e mudanças de visibilidade podem exigir reconciliação completa. `createdSince` detecta somente criações; equipe requer leitura completa. Cursor vinculado a operação, filtros e política de projetos. Parâmetros desconhecidos são rejeitados antes de consulta/reserva de linhas.
