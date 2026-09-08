# Contrato de interação: painel API Playground

## Entrada e navegação

- O módulo `admin` passa a ter navegação interna para **Contas** (`/admin/accounts`) e **Tokens de API** (`/admin/tokens`).
- Ambas as rotas exigem conta `ADMIN` no cliente para UX e no servidor para segurança.
- A rota de tokens aceita apenas estado não sensível: `etapa`, `q`, `status`, `scope`, `credential` e `operation`.
- Token, verificador, resposta e cabeçalho de autorização nunca entram em URL, histórico ou storage.

## Composição da página

Em desktop, o painel segue a referência funcional do Google OAuth 2.0 Playground:

```text
┌────────────────────────────────────┬──────────────────────────────┐
│ 1. Configurar credencial           │ Requisição                   │
│ 2. Selecionar permissões e gerar   │ GET /integracoes/v1/...      │
│ 3. Testar endpoint                 │ Authorization: ••••abcd      │
│                                    ├──────────────────────────────┤
│ Catálogo pesquisável / formulário  │ Resposta                     │
│                                    │ status · duração · itens     │
└────────────────────────────────────┴──────────────────────────────┘
```

Em celular, etapas, formulário, requisição e resposta são empilhados. A área de código pode rolar horizontalmente dentro do próprio cartão; o documento não pode rolar horizontalmente.

## Etapa 1 — Configurar credencial

Campos:

1. Nome da integração (obrigatório).
2. Finalidade (obrigatório).
3. Responsável/destinatário (obrigatório).
4. Contato e descrição não são solicitados na UI; seguem opcionais no contrato para compatibilidade.
6. Início: agora ou data/hora agendada.
7. Validade: 1 hora, 24 horas, 7 dias, 30 dias (padrão), 90 dias, personalizada ou sem expiração.
8. Projetos: todos com confirmação explícita ou seleção de um ou mais.
9. IPs/CIDRs permitidos (opcional, chips removíveis e validação por item).
10. Limites: requisições/minuto, requisições/dia, linhas/dia e itens/página.
11. Formato JSON fixo, sem seletor desnecessário. Início, projetos, IPs e limites ficam em configurações avançadas.

Salvar com campo obrigatório vazio marca o controle e sua mensagem com o padrão compartilhado. Selecionar “sem expiração” abre confirmação digitada `SEM EXPIRAÇÃO`, mostra o risco e explica a recomendação de rotação.

## Etapa 2 — Permissões e emissão

- Busca por nome, código, domínio ou descrição.
- Acordeões por domínio com badges de estado e sensibilidade.
- Cada escopo mostra operações, dados incluídos, exclusões e dependências.
- Cada linha do próprio catálogo possui checkbox; detalhes técnicos ficam em expansão separada. Não existe um segundo quadro genérico de permissões.
- Os 33 escopos implementados podem ser selecionados; os demais candidatos ficam bloqueados com explicação. Acordeões com seleção começam abertos. Downloads e custos selecionam também suas dependências; remover a base remove dependentes. O console mostra filtros de relatório/manutenção/item e distingue criação de atualização; equipe orienta leitura completa. Downloads também aparecem no teste como verificação JSON de acesso/disponibilidade, sem transferir arquivo.
- `PLANEJADO`, `RESERVADO` e `PROIBIDO` ficam desabilitados e explicam o motivo.
- Marcar evidência ou excluídos inclui/confirma dependências.
- Resumo final mostra identidade, validade, projetos, IPs, limites e escopos.
- O botão **Gerar token** só habilita com formulário válido e ao menos um escopo disponível.

Após gerar, `ApiTokenRevealModal` mostra:

- segredo completo uma única vez;
- prefixo/últimos quatro para futura identificação;
- botão copiar com confirmação visual e fallback de seleção;
- exemplo com `export FILTRO_API_TOKEN='cole-o-aqui'`, nunca com o token real incorporado ao comando;
- aviso de que fechar/recarregar torna o valor irrecuperável;
- confirmação “Salvei o token em local seguro” antes de fechar.

O valor existe somente em estado de memória do componente. Query cache, persistência Zustand, localStorage e sessionStorage não podem recebê-lo.

## Etapa 3 — Testar endpoint

- Selecionar credencial, **Permissão a testar** e operação. A permissão filtra consultas e verificações correspondentes, incluindo escopos opcionais; sem filtro, a busca inclui todas as operações. Permissão não concedida impede execução e orienta selecionar outro token/rotacionar, sem aumentar privilégio.
- Todos os parâmetros vêm dos descritores do servidor. RHF + Zod mostram erros por campo; paginação/snapshot ficam em expansão própria. Listagens explicam que não exigem ID individual. Campos obrigatórios identificam o recurso correto: registro de Qualidade, evidência, anexo ou documento.
- Downloads retornam `DOWNLOAD_CHECK`: id/MIME/tamanho e aviso de conteúdo não transferido. Copiar cURL usa saída binária e variável de token. Trocar operação/permissão/credencial limpa parâmetros/resposta e descarta respostas atrasadas; `testScope` e `operation` permanecem na URL sem dados consultados.

- Seleção exclusiva entre operações registradas e cobertas pelos escopos.
- Operações e parâmetros vêm de `GET /admin/api-scopes` (`operations`), sem lista fixa só de Qualidade no frontend. Ao trocar operação, filtros anteriores são limpos.
- Método e caminho são somente leitura e não editáveis.
- Formulário contém apenas parâmetros declarados pela operação.
- Painel de requisição mostra URL relativa, query normalizada e `Authorization: Bearer ••••<last4>`.
- Painel de resposta mostra status, requestId, duração, tamanho/linhas e JSON truncado por limite visual.
- Copiar comando usa `$FILTRO_API_TOKEN`; copiar resposta não inclui cabeçalhos secretos.
- Para credencial antiga cujo segredo não é conhecido pelo navegador, **Simular autorização** chama o endpoint admin de teste com o ID, usa o mesmo motor de escopos, projetos, filtros e cotas em modo de teste e gera evento `TESTED`; não recupera nem recria o token. A simulação não finge um IP do consumidor: mostra a política configurada e avisa que a allowlist de rede só é comprovada por uma chamada real originada no ambiente permitido.

## Lista, detalhe e ações

Filtros: texto, status efetivo, vencimento e escopo. Cada item mostra nome, destinatário, prefixo/últimos quatro, status, validade, escopos resumidos, último uso, requisições/linhas no período e alertas.

Ações:

- **Abrir no playground**: navega com ID não secreto.
- **Reduzir acesso**: permite retirar escopo/projeto/IP ou diminuir limites; efeito imediato.
- **Ampliar via rotação**: abre criação de substituta com resumo da mudança.
- **Rotacionar**: exige justificativa e escolha entre revogação imediata ou sobreposição curta com data final.
- **Revogar**: `ConfirmDialog` com justificativa obrigatória; ação irreversível.
- **Ver auditoria/uso**: paginação e filtros; nenhuma linha exibe segredo, cabeçalho ou corpo.

## Acessibilidade e responsividade

- Etapas são lista ordenada com estado atual anunciado; não dependem apenas de cor.
- Modais têm foco preso, retorno de foco, título/descrição e Escape conforme risco da ação.
- Checkboxes têm rótulo completo e dependências anunciadas.
- Status, risco e disponibilidade usam texto + ícone além de cor.
- Controles têm alvo de toque adequado e ordem de teclado coerente.
- Tabelas viram cartões abaixo do breakpoint; títulos/IDs podem truncar visualmente, com conteúdo completo acessível.
- Grades usam `minmax(min(100%, ...), 1fr)` ou equivalente e filhos flex/grid usam `min-width: 0`.

## Novidade e tutorial

- Na implementação, registrar uma constante de data de lançamento e calcular expiração global exatamente 10 dias depois.
- Durante a janela, exibir marcador **Novo** na entrada e um cartão central Driver.js na primeira visita de cada usuário/navegador.
- O tour apresenta: menor privilégio, validade, revelação única, teste seguro e revogação.
- “Ajuda” permite reabrir o tour durante os 10 dias.
- Depois da data global, selo e tutorial somem; não vira onboarding permanente porque é função de módulo existente.
