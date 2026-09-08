# API de integrações

Esta API fornece leitura controlada dos dados do Filtrovali sem conceder acesso direto ao banco. Estão implementadas 33 permissões e 35 operações externas GET, incluindo Qualidade, cadastros operacionais e a expansão de relatórios, estoque e manutenção. A disponibilidade no ambiente depende da publicação e homologação do código pelo operador; esta implementação não executa deploy.

O endereço base comum a todas as áreas é `/api/integracoes/v1`. Acrescente o caminho da consulta desejada, como `/projetos`, `/estoque/itens` ou `/qualidade/registros`. O segmento `/qualidade` identifica apenas as consultas desse setor. Na exibição única do token, o exemplo em cURL usa uma consulta compatível com as permissões concedidas.

## Autenticação

Uma conta `ADMIN` gera a credencial em **Administração → Tokens de API**. O valor completo aparece uma única vez; guarde-o em um cofre de segredos e identifique o responsável e a finalidade. Sessões humanas do app não funcionam nesta árvore e tokens de integração não funcionam como login.

No formulário, defina finalidade e destinatário, início/vencimento, escopos, recorte de projetos, CIDRs permitidos e cotas. Nenhuma permissão vem selecionada. Prefira validade curta, projetos selecionados e somente as permissões necessárias ao consumidor; acrescente metadados, download ou excluídos quando necessário. Credencial sem expiração exige confirmação explícita de risco.

Configure o segredo no processo consumidor sem colocá-lo em código, URL, planilha ou log:

```bash
# O processo injeta esta variável a partir do cofre; não registre o valor no shell history.
# Exemplo conceitual: secretRef "filtro/bi-qualidade" -> env FILTRO_API_TOKEN.
test -n "$FILTRO_API_TOKEN" || exit 1
curl --fail-with-body \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  "https://seu-dominio/api/integracoes/v1/qualidade/registros?limit=100"
```

Todas as respostas usam `Cache-Control: no-store` e `X-Request-Id`. Registre o request ID, nunca o header `Authorization`.

## Operações disponíveis

| Método | Caminho | Escopo obrigatório |
|---|---|---|
| `GET` | `/api/integracoes/v1/qualidade/registros` | `qualidade.registros.read` |
| `GET` | `/api/integracoes/v1/qualidade/registros/{id}` | `qualidade.registros.read` |
| `GET` | `/api/integracoes/v1/qualidade/naturezas` | `qualidade.naturezas.read` |
| `GET` | `/api/integracoes/v1/qualidade/evidencias/{id}/download` | registros + metadados + download |

`qualidade.evidencias.metadata.read` inclui metadados allowlisted. `qualidade.excluidos.read` é necessário para `includeDeleted=true`. Caminhos físicos, tokens públicos, sequências internas e identificadores de usuários não são publicados.

## Paginação e sincronização

### Novas coleções operacionais

Os caminhos abaixo usam a mesma base `/api/integracoes/v1`, autenticação Bearer e resposta paginada de Qualidade:

| Dados | Caminhos GET | Permissão |
|---|---|---|
| Colaboradores e cargos | `/colaboradores`, `/cargos` | `colaboradores.operacional.read`, `cargos.read`, respectivamente |
| Projetos e segmentos | `/projetos`, `/clientes/segmentos` | `projetos.read`, `clientes.segmentos.read`, respectivamente |
| Relatórios aprovados e DDS | `/rdo/relatorios`, `/rdo/dds` | `rdo.relatorios.read`, `rdo.dds.read`, respectivamente |
| Manutenções aprovadas | `/manutencao/registros` | `manutencao.registros.read` |
| Perfis e itens de manutenção | `/manutencao/perfis`, `/manutencao/perfis/itens` | `manutencao.perfis.read` |
| Limpezas de produção aprovadas | `/producao/limpezas` | `producao.limpezas.read` |
| Equipamentos e cadastro do RDO | `/equipamentos`, `/equipamentos/rdo` | `equipamentos.read` |
| Categorias de equipamentos | `/equipamentos/categorias` | `equipamentos.categorias.read` |
| Itens e categorias de estoque | `/estoque/itens`, `/estoque/categorias` | `estoque.itens.read` |

Essas permissões-base são minimizadas: relatórios trazem identificação, tipo, datas e horas; colaboradores trazem código/nome/cargo/ativo; equipamentos e estoque trazem cadastros. Arquivos e custos exigem permissões adicionais descritas abaixo. Consulte os campos exatos em [Contrato operacional](../specs/015-api-token-playground/contracts/operational-read.md).

Exemplo com uma credencial que contenha `rdo.relatorios.read`:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  "https://seu-dominio/api/integracoes/v1/rdo/relatorios?limit=20"
```

No modo de projetos selecionados, relatórios/produção respeitam o projeto; colaboradores são limitados à equipe de relatórios aprovados desses projetos. Manutenções avulsas só aparecem em `ALL`. Cargos, segmentos, DDS, perfis, equipamentos e itens/categorias de estoque são cadastros globais compartilhados e não aceitam `projectId`.

Tokens existentes não ganham permissões: gere um novo token com os escopos necessários no catálogo unificado. Os demais candidatos continuam desabilitados.

### Expansão de relatórios, estoque e manutenção

Foram acrescentadas 16 permissões específicas (13 consultas e 3 downloads). Cada uma exige a permissão-base do grupo; o catálogo seleciona as dependências automaticamente.

| Grupo | Novas consultas GET |
|---|---|
| Relatórios | `/rdo/versoes`, `/rdo/equipe`, `/rdo/servicos`, `/rdo/anexos`, `/rdo/assinaturas`, `/rdo/auditoria` |
| Estoque | `/estoque/lotes`, `/estoque/movimentos`, `/estoque/documentos`, `/estoque/custos` |
| Manutenção | `/manutencao/terceiros`, `/manutencao/anexos`, `/manutencao/auditoria` |

O [contrato da expansão](../specs/015-api-token-playground/contracts/operational-expanded-read.md) lista as permissões e os dados de cada operação. Assinaturas expõem situação/papel/datas, não nomes, imagens ou provas. Auditoria expõe ação/transição e data, não atores ou observações. `estoque.custos.read` requer também `estoque.movimentos.read` e `estoque.itens.read`; custos/quantidades decimais são strings, sem perda de precisão. Documentos de estoque são globais; lotes com projeto selecionado exigem movimento no projeto, mas não representam saldo por projeto.

Filtros por `reportId`, `maintenanceId` e `itemId` estão disponíveis apenas onde indicados no catálogo. As coleções sem `updatedAt` aceitam `createdSince`, que detecta somente criações. Equipe não possui timestamp: ordena por `(reportId,collaboratorId)` e exige leitura completa para reconciliação. Não envie `updatedSince` nessas operações.

```bash
# Escopos: estoque.itens.read + estoque.movimentos.read
curl --fail-with-body --get \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "limit=100" \
  --data-urlencode "createdSince=2026-09-01T00:00:00Z" \
  "https://seu-dominio/api/integracoes/v1/estoque/movimentos"
```

Downloads autenticados: `/rdo/anexos/{id}/download`, `/estoque/documentos/{id}/download` e `/manutencao/anexos/{id}/download`. Exigem base + metadados + `.download`. O console verifica acesso/disponibilidade e retorna JSON, sem transferir o arquivo; use um cliente HTTP para baixar. Os arquivos originais podem conter dados pessoais/financeiros e não são redigidos. Limite de 50 MiB por arquivo, medição de bytes e cotas de requisições existentes; não há nova cota diária de bytes.

```bash
# Escopos: rdo.relatorios.read + rdo.anexos.metadata.read + rdo.anexos.download
# ANEXO_ID deve vir da consulta /rdo/anexos. Escolha um arquivo de saída novo.
curl --fail \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  --output "anexo-baixado.bin" \
  "https://seu-dominio/api/integracoes/v1/rdo/anexos/${ANEXO_ID}/download"
```

Arquivos sem armazenamento local válido, com pasta de outro projeto, com links simbólicos ou fora das pastas gerenciadas retornam 404. Anexos legados de RDO fora da pasta atual do projeto não são liberados por fallback. Documentos legados de estoque em `Estoque/FISPQ` são suportados sem expor seu token.

### Como percorrer páginas

Coleções retornam `items`, `page`, `generatedAt`, `schemaVersion` e `requestId`. Use `page.nextCursor` exatamente como recebido. O cursor é assinado, fixa `snapshotAt`, inclui a posição de ordenação da coleção e está vinculado à operação, filtros e política de projetos; não o edite nem reutilize com outros filtros.

Para uma carga completa:

1. faça a primeira chamada sem cursor;
2. processe `items` de forma idempotente pelo `id` (equipe: `reportId` + `collaboratorId`);
3. repita os mesmos filtros com `cursor=page.nextCursor` até `hasMore=false`;
4. grave o maior `updatedAt` confirmado somente ao concluir o snapshot, onde essa coluna existir; `createdAt` acompanha apenas criações e equipe não possui watermark.

Para sincronização incremental, informe `updatedSince` em UTC. Em Qualidade, para remoções, conceda o escopo de excluídos e use `includeDeleted=true`; `deletedAt` funciona como tombstone. As novas coleções operacionais não têm tombstones: faça reconciliação completa periódica para remoções ou mudanças de visibilidade/vínculos. O teto não é um snapshot transacional; use upsert e sobreposição temporal para alterações concorrentes. Em caso de falha intermediária, retome pelo último cursor confirmado.

## Limites e erros

- `400 VALIDATION_ERROR` ou `INVALID_CURSOR`: corrija parâmetros; não repita automaticamente.
- `401 INVALID_TOKEN`: token ausente, inválido, agendado, expirado ou revogado. As causas são deliberadamente indistinguíveis.
- `403 INSUFFICIENT_SCOPE`, `PROJECT_NOT_ALLOWED` ou `IP_NOT_ALLOWED`: a política da credencial não permite a operação.
- `404 NOT_FOUND`: o recurso não existe ou não pertence ao recorte permitido.
- `409`: conflito administrativo de versão/idempotência.
- `413 FILE_TOO_LARGE`: arquivo excede 50 MiB.
- `429 RATE_LIMITED`/`QUOTA_EXCEEDED`: respeite `Retry-After` e aplique backoff com jitter.
- `5xx`: repita apenas operações `GET`, com backoff e o mesmo cursor.

O limite efetivo por página é o menor entre o valor global (500) e o limite da credencial. Cotas de minuto/dia e linhas/dia são persistidas e compartilhadas entre instâncias do backend.

## Rotação e incidente

Para ampliar qualquer permissão, projeto, rede, validade ou limite, rotacione a credencial. Reduções e revogações têm efeito na chamada seguinte. Em suspeita de vazamento, revogue imediatamente, preserve somente request IDs/evidências não sensíveis e gere uma substituta com o menor privilégio possível.

O contrato completo está em `specs/015-api-token-playground/contracts/openapi.yaml`.

## Administração e auditoria

### Gerenciar a política do token

Em **Meus tokens**, use os filtros e **Próxima página** para encontrar a credencial. **Ver detalhes** abre suas ações, consumo e histórico paginado, com responsável, justificativa e resumo da alteração. **Abrir no Playground** seleciona explicitamente esse token para o teste. A seleção e o detalhe ficam na URL pelo identificador público da credencial, inclusive após atualizar a página; nunca pelo segredo. Uma credencial indisponível não é substituída automaticamente por outra.

- **Reduzir acesso** permite retirar permissões e dependentes, restringir projetos/IPs, reduzir os quatro limites e antecipar ou definir expiração. Uma política já restrita não pode virar irrestrita. Justificativa obrigatória; erros aparecem junto aos campos.
- **Rotacionar** copia a política atual para um editor de substituta, permitindo revisar permissões, projetos, IPs, validade e limites. Informe justificativa, sobreposição de 0/15/30/60 minutos e digite `ROTACIONAR`. Revise antes de gerar. Validade sem expiração exige uma nova confirmação `SEM EXPIRAÇÃO`.
- **Revogar** exige justificativa e o texto `REVOGAR`. A ação é terminal. Nunca informe o segredo na justificativa.

Erros do teste aparecem no console com status HTTP, código, mensagem e requestId, quando recebido; uma nova tentativa limpa o resultado anterior. Falha de conexão não inventa status ou requestId. O envelope administrativo mantém `error` e inclui `message`, `code`, `requestId` e, quando aplicável, `fields`, sem stack ou dados secretos.

### Testar qualquer permissão implementada

1. Em **Testar API**, escolha a credencial e **Permissão a testar**. Todas as 33 permissões implementadas estão disponíveis para seleção; o botão de execução só libera as concedidas ao token.
2. Escolha uma das operações correspondentes. Uma permissão pode participar de várias operações; o painel não a transforma em acesso irrestrito.
3. Preencha somente os parâmetros exibidos. Listagens não exigem ID individual; os filtros são opcionais. Consulta individual e downloads indicam qual ID copiar e de qual listagem. Cursor e snapshot estão em **Paginação e snapshot**.
4. Execute o teste. Nos quatro downloads, **Verificar acesso ao arquivo** retorna id, MIME e tamanho, sem bytes do arquivo, links públicos ou caminhos. A verificação é limitada a 50 MiB e consome requisição/cota do JSON devolvido, não o volume total do arquivo.
5. Para comprovar o download, o token Bearer e o IP permitido, execute o cURL fora do painel, no ambiente real do consumidor. Defina `FILTRO_API_BASE_URL` com a origem do app, sem barra final (ex.: `https://app.exemplo.com`), e `FILTRO_API_TOKEN` com o segredo de teste no terminal. A simulação administrativa não recupera o segredo do token e não comprova a rede do consumidor.

Ao trocar permissão, operação ou credencial, parâmetros e resposta são limpos. A navegação preserva a seleção na URL, mas nunca o ID consultado, a resposta ou o segredo. Tokens antigos não ganham permissões; use outro token ou rotacione quando necessário.

O painel lista status efetivo, prefixo/últimos quatro caracteres, escopos, projetos, validade, último uso, linhagem de rotação e consumo recente. A trilha administrativa registra criação, redução, teste, rotação e revogação; os logs de uso guardam apenas operação, template de caminho, contagens, duração, resultado e filtros allowlisted. Headers, corpos, respostas, token e verificador não são persistidos.

Uma edição só pode reduzir acesso. Para ampliar escopo, projetos, CIDRs, validade ou limites, use **Rotacionar**, armazene o novo segredo no cofre e encerre a sobreposição em até 60 minutos. **Revogar** é terminal e exige motivo; nunca cole o segredo no motivo.

O catálogo do painel contém os 126 modelos de negócio em 20 domínios. Há 33 permissões disponíveis (5 de Qualidade, 12 operacionais iniciais e 16 desta expansão), selecionáveis dentro de cada domínio; 49 candidatos de outros grupos continuam bloqueados. Campos e endpoints podem ser consultados na própria linha. Somente as projeções e arquivos explicitamente contratados são publicados. Tokens antigos não recebem permissões novas automaticamente: emita outro ou rotacione com as permissões desejadas.
