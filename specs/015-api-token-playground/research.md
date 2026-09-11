# Research: API Playground e tokens de integração

## 1. Tipo de credencial

**Decisão**: usar uma credencial de serviço opaca, própria do FiltroApp, transmitida como Bearer sobre HTTPS. O valor terá formato reconhecível (`fva_<seletor>_<segredo>`), seletor público aleatório e segredo com pelo menos 256 bits gerados por fonte criptográfica. O banco guarda seletor, últimos quatro caracteres, versão da chave e um verificador HMAC-SHA-256 calculado com um `pepper` externo ao banco; a comparação do verificador é constante. Como o segredo já tem alta entropia, não se usa algoritmo lento de senha.

**Razão**: o caso é servidor-a-servidor, sem consentimento delegado nem identidade do colaborador no app. Um token opaco pode ser revogado imediatamente, não carrega privilégios legíveis/desatualizados e evita entregar credenciais de banco. O uso no cabeçalho segue o modelo interoperável de Bearer tokens descrito pelo [RFC 6750](https://www.rfc-editor.org/info/rfc6750/).

**Alternativas rejeitadas**:

- OAuth 2.0 completo: adicionaria clientes, redirecionamentos, consentimento, authorization code e refresh token sem existir delegação de usuário.
- JWT autossuficiente: dificulta revogação e redução imediata de escopos, além de deixar claims válidas até expirar.
- Usuário/senha ou acesso read-only ao PostgreSQL: amplia superfície, acopla o consumidor ao esquema interno e contorna projeções, cotas e auditoria por operação.
- Guardar o token cifrado para recuperação: aumenta o impacto de comprometimento e contradiz a revelação única.

## 2. Inspiração no Google OAuth 2.0 Playground

**Decisão**: adaptar o fluxo visual da página oficial do [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/?skip_cache=false): seleção pesquisável, etapas progressivas, configuração e painel de requisição/resposta. No FiltroApp as etapas serão “Configurar credencial”, “Selecionar permissões e gerar” e “Testar endpoint”.

**Razão**: a organização reduz carga cognitiva e deixa a relação entre permissão, credencial e chamada visível.

**Limite da referência**: o produto não copiará marca, layout pixel a pixel nem semântica OAuth. O console aceita somente operações do catálogo. Permitir URL externa ou cabeçalhos/corpo livres transformaria o servidor em proxy e criaria risco de requisições a destinos internos.

## 3. Validade, rotação e privilégio

**Decisão**: validade temporária é o padrão, inicialmente 30 dias, com presets de 1 hora, 24 horas, 7, 30 e 90 dias e data personalizada. “Sem expiração” existe, mas começa desabilitado, exige confirmação digitada e gera alerta contínuo de revisão. Revogação é imediata. Rotação cria outra credencial/segredo e pode revogar a antiga imediatamente ou após sobreposição curta e explicitamente datada. Reduzir escopo/recurso é imediato; aumentar exige rotação.

**Razão**: validade curta e menor privilégio limitam exposição. Exigir rotação para aumento impede que um token já entregue ganhe poderes silenciosamente.

**Alternativas rejeitadas**:

- Token permanente como padrão: torna esquecimento e vazamento duradouros.
- Editar livremente qualquer escopo: o destinatário não percebe mudança de confiança.
- Renovar o mesmo segredo: impede distinguir uso antigo e novo durante incidentes.

Criação, rotação e revogação exigem `Idempotency-Key`. Repetir a mesma ação não gera outra credencial. Como o segredo não é armazenado de forma recuperável, uma resposta de emissão perdida não pode ser reproduzida: o admin deve rotacionar, mantendo o incidente auditado.

## 4. Escopos e catálogo central

**Decisão**: códigos de escopo e operações são um registro versionado em código. O banco persiste apenas concessões referenciando códigos conhecidos. Cada entrada declara domínio, sensibilidade, disponibilidade, projeção de campos, dependências e exclusões. O painel nunca cria permissões livres. Qualidade começa com cinco escopos: `qualidade.registros.read`, `qualidade.naturezas.read`, `qualidade.evidencias.metadata.read`, `qualidade.evidencias.download` e `qualidade.excluidos.read`.

**Razão**: uma allowlist revisável evita transformar o catálogo em acesso genérico a tabelas. Separar evidência, download e excluídos mantém o escopo básico pequeno.

**Alternativas rejeitadas**:

- Um escopo único `read:any`: não expressa finalidade nem menor privilégio.
- Escopo por tabela/campo definido no painel: cria uma ferramenta de consulta arbitrária, difícil de versionar e testar.
- Reutilizar papéis de usuários humanos: os papéis atuais incluem capacidades de interface e escrita que não pertencem a integrações.

## 5. API de Qualidade e sincronização

**Decisão**: publicar uma projeção própria sob `/api/integracoes/v1/qualidade`, usando cursor opaco assinado, ordem total `(updatedAt, id)`, `updatedSince`, `limit` máximo global de 500 e máximo menor por credencial. A primeira página fixa `page.snapshotAt` e o cursor preserva esse teto nas páginas seguintes. O envelope inclui `items`, `page.nextCursor`, `page.snapshotAt`, `generatedAt`, `schemaVersion` e `requestId`. Excluídos lógicos só aparecem com escopo próprio e `deletedAt`. Evidências são metadados opcionais; arquivo é transmitido por endpoint autenticado pelo ID.

**Razão**: cursor e desempate tornam carga completa e incremental determinísticas. Uma projeção externa evita vazar campos que venham a ser adicionados ao Prisma. Download autenticado evita publicar `storagePath` e `publicToken`.

**Alternativas rejeitadas**:

- Offset/limit para sincronização: inserções/alterações durante a paginação podem mover linhas.
- Retornar o objeto Prisma completo: qualquer evolução do banco poderia mudar ou ampliar a API por acidente.
- Reutilizar links públicos de evidência: o link escaparia do ciclo de vida e dos escopos do token.
- Um XLSX irrestrito como API principal: dificulta sincronização incremental, controle por item e evolução contratual.

## 6. Restrições e cotas

**Decisão**: oferecer início/fim, allowlist opcional de CIDR IPv4/IPv6, modo de projetos `ALL` ou `SELECTED`, formatos habilitados, requisições/minuto, requisições/dia, linhas/dia e página máxima. Aplicar contadores persistentes por janela com atualização atômica; o servidor pode manter proteção adicional em memória contra rajadas, mas a cota autoritativa não pode desaparecer ao reiniciar. Respostas de limite usam `429`, código estável e `Retry-After` quando calculável.

**Razão**: consumo de API precisa de limites de recurso; o [OWASP API Security Top 10 — API4:2023](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/) recomenda limitar recursos como registros por página, frequência e tempo de execução.

**Alternativas rejeitadas**:

- Somente limite global por IP: integrações diferentes compartilhariam cota e NATs causariam falsos positivos.
- Somente memória do processo: reinício ou múltiplas instâncias anulam a cota.
- Exportação sem paginação: uma chamada poderia monopolizar banco, memória e rede.

## 7. Auditoria e minimização de logs

**Decisão**: separar eventos administrativos imutáveis de registros resumidos de uso. Guardar ator/credencial/operação/resultado/contagens/duração/requestId e apenas origem necessária à segurança, com retenção inicial de 365 dias. Não guardar segredo, verificador, `Authorization`, resposta completa, query bruta, caminho físico ou payload pessoal. O segredo ficará somente na memória do componente até fechar/recarregar. Exemplos de `curl` usarão `$FILTRO_API_TOKEN`.

**Razão**: auditoria permite revogar e investigar sem criar uma nova coleção de segredos ou dados pessoais. A orientação do [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) fundamenta ciclo de vida, rotação, revogação e cuidado com logs.

**Alternativas rejeitadas**:

- Registrar corpo de resposta para depuração: replica dados sensíveis e aumenta obrigação de retenção.
- Gravar o segredo em localStorage/sessionStorage: scripts da página e extensões poderiam lê-lo; o valor sobreviveria além do momento de entrega.
- Incluir o segredo pronto no comando copiado: aumenta chance de vazamento em histórico, chat e ticket.

## 8. Fronteira de autenticação e navegador

**Decisão**: rotas administrativas continuam usando a sessão humana existente e `requireHubAdmin`. A árvore externa usa middleware separado, aceita só Bearer com formato de integração e não tenta autenticação humana. Antes da busca por seletor, há limite grosseiro por IP; seletores inexistentes passam por comparação HMAC com verificador fictício para reduzir diferença observável. CORS permanece fechado por padrão; integrações usam HTTPS servidor-a-servidor. Respostas de segredo e dados usam `Cache-Control: no-store`. O playground testa uma operação allowlisted via serviço administrativo auditado ou, durante a revelação, com o segredo mantido somente em memória.

**Razão**: separar as fronteiras evita que uma sessão humana funcione acidentalmente na API externa ou que token externo alcance endpoints internos.

**Detalhe do código atual**: o middleware `requireHubAdmin` já exige `accountType === 'ADMIN'` e é a referência correta no servidor. No frontend, o acesso deve vir do grupo do módulo `admin`, que também exige `ADMIN`; o helper `isHubAdmin` isolado não serve como barreira desta tela porque aceita ainda o papel legado `MANAGER`.

**Alternativas rejeitadas**:

- Um middleware que tenta sessão e token indistintamente: aumenta confusão e risco de bypass.
- CORS aberto: incentiva uso do segredo no navegador e amplia origens capazes de chamar a API.

## 9. Ativação incremental dos demais domínios

**Decisão**: catalogar agora todos os 126 modelos, mas habilitar apenas Qualidade. Cada domínio futuro precisa de finalidade, classificação, contrato OpenAPI, serializador por allowlist, testes positivos/negativos, limites e aprovação de privacidade quando houver PII, finanças, assinatura ou LGPD.

**Razão**: o inventário atende à governança e evita lacunas, enquanto a publicação incremental reduz o impacto de erro. “Há uma tabela” não equivale a “há uma API segura”.

**Alternativas rejeitadas**:

- Gerador CRUD para todo o Prisma: exporia relações e campos internos sem revisão.
- Ativar todos os escopos de uma vez: produziria uma superfície grande demais para validar na primeira entrega.
