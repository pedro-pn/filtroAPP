# Conferência final por página — 02/10/2026

## Cobertura e evidências

Foram percorridas 107 telas/estados dos 12 módulos, áreas administrativas, perfis do RDO, páginas públicas e diálogos de documentos do Efetivo. A matriz inicial gerou **1.284 recortes**: Chromium e WebKit × celular (390 × 844), tablet (768 × 1024) e desktop (1280 × 900) × claro/escuro. Celular e tablet usam emulação de toque.

A primeira execução identificou uma seleção sem nome acessível no cliente e problemas de contraste no escuro. Depois das correções, 29 telas foram repetidas nas 12 combinações (**348 recortes**). O último ajuste do planejamento e a classificação do X como ícone foram repetidos em três telas, nas 12 combinações (**36 recortes**). As evidências finais combinam os registros mais recentes de cada tela; não representam uma segunda execução integral.

Não houve overflow horizontal global maior que 1 px, imagens quebradas ou exceções de JavaScript no inventário completo. O erro de código inválido da validação pública é um estado esperado, não uma falha de carregamento.

Artefatos locais (ignorados pelo Git; podem conter links de teste):

- `output/validation/final-initial-audit/`: matriz completa, JSON incremental e PNGs.
- `output/playwright/redesign-final-verification/`: repetição das 29 telas afetadas.
- `output/playwright/redesign-final-last-fixes/`: últimas três telas e interações mobile.

## Ajustes realizados durante a conferência

- Nome acessível da seleção individual no portal do cliente.
- Filtros e linhas mobile de equipamentos passam a usar superfícies do tema.
- Busca compartilhada mantém fundo e texto corretos também com foco no escuro.
- Indicador de EPI, etiquetas de colaboradores e texto verde usam cores legíveis.
- O fundo secundário do planejamento foi escurecido para preservar o contraste dos status.
- Área e identificação das páginas do PDF acompanham o tema; somente o papel do PDF permanece branco.
- O carregamento individual de páginas do PDF também usa a animação aprovada da logo.
- Cache do Vite isolado para o servidor de validação, sem interferência dos testes SSR ou do app normal.

O contraste automático cobre texto visível sobre fundos planos: 4,5:1 para texto comum e 3:1 para texto grande/controles compostos somente por ícones. Imagens, gradientes, opacidade herdada e cores de placeholders/valores dos inputs não recebem uma medição completa nesse verificador. Há inspeção visual complementar das capturas; isso não equivale a certificação WCAG.

## Matriz página a página

**OK** significa geometria global, nomes acessíveis, imagens, exceções, tema e estado de carregamento conferidos nos dois motores. A medição de contraste tem os limites descritos acima. Subabas vazias também são estados válidos. Demonstrações não comprovam gravação; os cinco fluxos de persistência têm evidência separada no registro do fechamento.

| Tela/estado | Celular claro | Celular escuro | Tablet claro | Tablet escuro | Desktop claro | Desktop escuro |
| --- | --- | --- | --- | --- | --- | --- |
| modulos | OK | OK | OK | OK | OK | OK |
| conta | OK | OK | OK | OK | OK | OK |
| operacoes | OK | OK | OK | OK | OK | OK |
| admin/accounts | OK | OK | OK | OK | OK | OK |
| admin/tokens / credenciais | OK | OK | OK | OK | OK | OK |
| admin/tokens / configurar | OK | OK | OK | OK | OK | OK |
| admin/tokens / playground | OK | OK | OK | OK | OK | OK |
| rdo/gestor / pendentes | OK | OK | OK | OK | OK | OK |
| rdo/gestor / aprovados | OK | OK | OK | OK | OK | OK |
| rdo/gestor / projetos | OK | OK | OK | OK | OK | OK |
| rdo/gestor / arquivados | OK | OK | OK | OK | OK | OK |
| rdo/gestor / equipe | OK | OK | OK | OK | OK | OK |
| rdo/gestor / usuarios | OK | OK | OK | OK | OK | OK |
| rdo/gestor / nps | OK | OK | OK | OK | OK | OK |
| rdo/gestor / estatisticas | OK | OK | OK | OK | OK | OK |
| RDO / detalhe | OK | OK | OK | OK | OK | OK |
| RDO / novo | OK | OK | OK | OK | OK | OK |
| manutencao-producao / manutencao | OK | OK | OK | OK | OK | OK |
| manutencao-producao / producao | OK | OK | OK | OK | OK | OK |
| manutencao-producao / programacao-manutencao | OK | OK | OK | OK | OK | OK |
| manutencao-producao / historico-manutencao | OK | OK | OK | OK | OK | OK |
| Manutenção / novo relatório | OK | OK | OK | OK | OK | OK |
| Produção / novo relatório | OK | OK | OK | OK | OK | OK |
| equipamentos / dashboard | OK | OK | OK | OK | OK | OK |
| equipamentos / categories | OK | OK | OK | OK | OK | OK |
| equipamentos / config | OK | OK | OK | OK | OK | OK |
| equipamentos / maintenance | OK | OK | OK | OK | OK | OK |
| equipamentos / notifications | OK | OK | OK | OK | OK | OK |
| estoque / resumo | OK | OK | OK | OK | OK | OK |
| estoque / movimentacoes | OK | OK | OK | OK | OK | OK |
| estoque / itens | OK | OK | OK | OK | OK | OK |
| estoque / categorias | OK | OK | OK | OK | OK | OK |
| qualidade / registros | OK | OK | OK | OK | OK | OK |
| qualidade / naturezas | OK | OK | OK | OK | OK | OK |
| Qualidade / formulário | OK | OK | OK | OK | OK | OK |
| epi / collaborators | OK | OK | OK | OK | OK | OK |
| epi / catalog | OK | OK | OK | OK | OK | OK |
| EPI / ficha | OK | OK | OK | OK | OK | OK |
| romaneio / romaneios | OK | OK | OK | OK | OK | OK |
| romaneio / equipamentos | OK | OK | OK | OK | OK | OK |
| romaneio / notificacoes | OK | OK | OK | OK | OK | OK |
| Romaneio / novo | OK | OK | OK | OK | OK | OK |
| Romaneio / edição | OK | OK | OK | OK | OK | OK |
| acompanhamento / dashboard | OK | OK | OK | OK | OK | OK |
| acompanhamento / projetos | OK | OK | OK | OK | OK | OK |
| acompanhamento / sede | OK | OK | OK | OK | OK | OK |
| acompanhamento / custo | OK | OK | OK | OK | OK | OK |
| Acompanhamento / custo / ponto | OK | OK | OK | OK | OK | OK |
| Acompanhamento / custo / auditoria | OK | OK | OK | OK | OK | OK |
| Acompanhamento / custo / rates | OK | OK | OK | OK | OK | OK |
| Acompanhamento / custo / categorias | OK | OK | OK | OK | OK | OK |
| Acompanhamento / custo / simulador | OK | OK | OK | OK | OK | OK |
| Acompanhamento / projeto | OK | OK | OK | OK | OK | OK |
| efetivo / visao-geral | OK | OK | OK | OK | OK | OK |
| efetivo / calendario | OK | OK | OK | OK | OK | OK |
| efetivo / colaboradores | OK | OK | OK | OK | OK | OK |
| efetivo / disponibilidade | OK | OK | OK | OK | OK | OK |
| efetivo / evolucao | OK | OK | OK | OK | OK | OK |
| efetivo / produtividade | OK | OK | OK | OK | OK | OK |
| efetivo / administracao | OK | OK | OK | OK | OK | OK |
| Efetivo / administração / feriados | OK | OK | OK | OK | OK | OK |
| Efetivo / administração / notificacoes | OK | OK | OK | OK | OK | OK |
| Efetivo / administração / atividade | OK | OK | OK | OK | OK | OK |
| Efetivo / disponibilidade em calendário | OK | OK | OK | OK | OK | OK |
| Efetivo / calendário / day | OK | OK | OK | OK | OK | OK |
| Efetivo / calendário / week | OK | OK | OK | OK | OK | OK |
| Efetivo / colaboradores / ficha | OK | OK | OK | OK | OK | OK |
| Efetivo / evolução / planejamento | OK | OK | OK | OK | OK | OK |
| assinaturas / active | OK | OK | OK | OK | OK | OK |
| assinaturas / archived | OK | OK | OK | OK | OK | OK |
| Assinaturas / novo documento | OK | OK | OK | OK | OK | OK |
| Assinaturas / rascunho / setup | OK | OK | OK | OK | OK | OK |
| Assinaturas / rascunho / audit | OK | OK | OK | OK | OK | OK |
| Assinaturas / publicado / details | OK | OK | OK | OK | OK | OK |
| Assinaturas / publicado / audit | OK | OK | OK | OK | OK | OK |
| Privacidade / solicitações | OK | OK | OK | OK | OK | OK |
| Colaborador / /rdo/home | OK | OK | OK | OK | OK | OK |
| Colaborador / /rdo/andamento | OK | OK | OK | OK | OK | OK |
| Colaborador / /rdo/meus-relatorios | OK | OK | OK | OK | OK | OK |
| Colaborador / /rdo/meus-relatorios/arquivados | OK | OK | OK | OK | OK | OK |
| Colaborador / /rdo/relatorio/novo | OK | OK | OK | OK | OK | OK |
| Coordenador / relatórios | OK | OK | OK | OK | OK | OK |
| Coordenador / detalhe | OK | OK | OK | OK | OK | OK |
| Cliente / relatórios | OK | OK | OK | OK | OK | OK |
| Login | OK | OK | OK | OK | OK | OK |
| Recuperar senha | OK | OK | OK | OK | OK | OK |
| Redefinir senha / token ausente | OK | OK | OK | OK | OK | OK |
| Política de privacidade | OK | OK | OK | OK | OK | OK |
| Direitos do titular | OK | OK | OK | OK | OK | OK |
| Confirmação de e-mail / demonstração | OK | OK | OK | OK | OK | OK |
| Preferências / demonstração | OK | OK | OK | OK | OK | OK |
| Pesquisa / demonstração | OK | OK | OK | OK | OK | OK |
| Assinatura RDO / demonstração | OK | OK | OK | OK | OK | OK |
| Validação RDO / código inválido | OK | OK | OK | OK | OK | OK |
| Validação avulsa / código inválido | OK | OK | OK | OK | OK | OK |
| Galeria de demonstrações | OK | OK | OK | OK | OK | OK |
| Animações de carregamento | OK | OK | OK | OK | OK | OK |
| Operações / demonstração | OK | OK | OK | OK | OK | OK |
| Documentos / demonstração | OK | OK | OK | OK | OK | OK |
| EPI / assinatura pública | OK | OK | OK | OK | OK | OK |
| Assinatura avulsa / convite | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Adicionar documento | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Editar documento | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Adicionar versão | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Registrar aceite | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Encerrar projeto antigo | OK | OK | OK | OK | OK | OK |
| Efetivo / diálogo / Checklist de contato | OK | OK | OK | OK | OK | OK |

## Interações e gates

- 645/645 testes frontend; lint, tipagem E2E, build e gate de arquitetura aprovados.
- Persistência: 5/5 fluxos reais com API e PostgreSQL isolado.
- Revisão transversal anterior: 18/18 testes, incluindo permissões de leitura/sem acesso, foco/Escape/retorno, tutorial do Hub e consentimento real do cliente.
- Mobile: toques nos comandos de início/fim, cabeçalho por direção de rolagem, bloqueio do fundo do menu Mais e fechamento pelo handler de arraste. O gesto de fechamento foi exercitado com eventos sintéticos; não substitui o teste em aparelho físico.
- A última suíte passou 14/14 testes nos dois motores. O verificador reconhece o pequeno X vermelho como ícone com nome acessível, aplicando o critério de contraste não textual.

## Pontos de acabamento identificados

| ID | Tela e condição | Observação / próxima ação |
| --- | --- | --- |
| UX-E1 | Efetivo → Evolução → Planejamento, celular 390 px, ambos os temas | Os metadados do cabeçalho usam rolagem horizontal local; parte da data fica fora do recorte inicial. Reorganizar em linhas se a intenção for apresentar tudo simultaneamente. A página inteira não estoura. |
| UX-E2 | Efetivo → Documentos → Adicionar versão (e arquivo inicial), todos os dispositivos | O input usa o seletor nativo de arquivo, enquanto Assinaturas e Equipamentos usam área tracejada. Padronizar a apresentação; o upload atual permanece funcional e rotulado. |

Não foram identificadas outras inconsistências reproduzíveis nos recortes conferidos. Permanecem fora desta rodada a homologação em celulares/tablets físicos, leitor de tela, câmera/canvas de assinatura física e entrega SMTP externa. O SMTP de teste só captura mensagens localmente.
