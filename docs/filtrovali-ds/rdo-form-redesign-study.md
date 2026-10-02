# Estudo de migração visual — Formulário de RDO

> Data do levantamento: 3 de setembro de 2026  
> Auditoria pós-implementação: 4 de setembro de 2026
> Tela principal: `frontend/src/pages/collaborator/NewReportPage.tsx`  
> Escopo: adequação ao Filtrovali DS sem alterar fluxos, regras ou contratos do RDO.

## Estado pós-implementação

O formulário principal e o editor estão **visualmente migrados**. Ambos usam
`AppShell`, `PageHeader`, `FormStepper`, `Switch`, cards e ações do design system,
mantêm o fluxo de três etapas e compartilham a mesma composição visual. A variante
“somente serviço”, autosave, validações, uploads, seis tipos de serviço e regras de
equipe permaneceram preservados.

As decisões refinadas durante a implementação também foram incorporadas:

- no mobile, a escala de leitura do formulário original foi preservada e os cards
  internos redundantes dos serviços foram achatados;
- no desktop, o formulário permanece estreito e centralizado, semelhante à leitura
  mobile, por decisão posterior ao estudo inicial;
- os campos dos serviços foram separados por tema no desktop e compactados no
  mobile;
- criação e edição reutilizam os mesmos elementos e estilos;
- upload, foco, stepper entre navegadores, anexos e ações finais receberam ajustes
  específicos de tema e responsividade.

### Fechamento técnico do formulário

As três pendências confirmadas foram concluídas em 04/09/2026:

1. os controles condicionais de DDS, standby e turno noturno receberam `Field`,
   IDs estáveis e nomes acessíveis; o tema personalizado possui `aria-label`;
2. `NewReportPage.tsx` e `ReportDetailPage.tsx` voltaram aos budgets por extração de
   formatação/identidade de serviços e ações do detalhe, sem mover regras de domínio;
3. foi adicionada uma suíte visual determinística em claro/escuro, Chromium/Firefox
   e 390, 768, 1.024 e 1.280 px.

Na mesma rodada, a remoção de fotos existentes passou a usar confirmação DS sem
alterar o `photoDeletionStaging`. As rotas públicas e a barreira de consentimento,
embora externas ao formulário, também foram fechadas no roadmap do módulo.

## Decisão

A migração deve ser feita como uma troca da camada de apresentação. O formulário já
possui regras de negócio e estados consolidados; portanto, não deve ser reescrito nem
ter sua navegação reinventada.

O resultado esperado é o mesmo formulário, com as mesmas três etapas e os mesmos
comportamentos, apresentado dentro do `AppShell`, responsivo de fato e composto pelos
controles do design system. No fluxo “somente serviço” do gestor, continuam existindo
apenas as duas etapas atuais.

## Diagnóstico atual

O formulário ainda usa a estrutura legada `Shell` + `TopBar`, classes globais do
`base.css`, controles HTML crus e estilos inline. A largura visual fica limitada a
aproximadamente 540 px mesmo em desktop e tablet. Em uma viewport de 1.440 px, cerca
de 900 px ficam sem uso; o formulário continua com aparência de tela mobile ampliada.

No mobile o conteúdo ocupa a largura disponível, mas a barra superior quebra em duas
linhas, alguns campos de texto ficam abaixo de 16 px e a edição de serviços forma um
card muito comprido e denso. A escolha de tipo de serviço já se comporta como uma
folha inferior, porém ainda é uma implementação local, sem os ícones e componentes
padronizados do app.

### Inventário de superfície

| Arquivo | Linhas | Controles HTML nativos | Estilos inline |
|---|---:|---:|---:|
| `NewReportPage.tsx` | 1.701 | 26 | 20 |
| `NewReportSpecialConditions.tsx` | 251 | 16 | 10 |
| `ServiceFields.tsx` | 1.369 | 57 | 4 |
| `DraftSaveStatus.tsx` | 23 | — | — |
| `ReportWorkforceNotices.tsx` | 86 | 3 | 2 |
| `UploadField.tsx` | 237 | 2 | — |
| **Total auditado** | **3.667** | **104** | **36** |

Esses números não significam que a lógica precise ser dividida ou reescrita nesta
fase. Eles mostram que a migração deve ser incremental e protegida por testes de
caracterização.

## Contratos funcionais que não podem mudar

A implementação visual deve preservar integralmente:

- criação, atualização, deduplicação e remoção dos rascunhos;
- autosave após projeto/data, incluindo o debounce atual de 150 ms;
- sequência Cabeçalho → Serviços → Finalização e as validações entre etapas;
- variante de duas etapas usada pelo gestor no fluxo “somente serviço”;
- verificação de RDO duplicado e aviso de projeto sem líder;
- reset da equipe e dos colaboradores do serviço ao trocar o projeto;
- continuação de serviço e sugestões oriundas de missão;
- conflitos de ausência e suas justificativas;
- DDS diurno/noturno, sobreaviso e turno noturno, com todos os campos condicionais;
- os seis tipos de serviço e suas regras específicas;
- inclusão/remoção de serviço, etapas e temas personalizados;
- upload, exclusão em estágio e restauração de fotos;
- cálculo/justificativa de horas extras, envio final e limpeza do rascunho;
- estados de carregamento, erro e desabilitação já existentes.

Também permanecem os contratos utilizados por testes, foco e rolagem até erros:

- IDs `rdo-project`, `rdo-date`, `rdo-arrival`, `rdo-departure`, `rdo-lunch`,
  `rdo-overtime` e `rdo-description`;
- atributos `data-invalid-target` do cabeçalho, serviços e condições especiais;
- `data-service-id` em cada serviço;
- seletor `[data-dds-novelty]` usado pelo guia do DDS;
- semântica e teclado das etapas, incluindo `aria-selected`/`aria-current`;
- comportamento atual: etapas anteriores podem ser abertas; avançar depende da
  validação; etapas futuras não são acessíveis diretamente.

## Direção visual proposta

### Estrutura geral

- Aplicar `.fv-ds` no menor limite que contenha todo o formulário.
- Trocar `Shell`/`TopBar` por `AppShell` e `PageHeader`, usando o mesmo modelo de
  navegação já adotado pelo Hub e pelas páginas migradas.
- Preservar uma coluna estreita e centralizada para o corpo do formulário também no
  desktop. Esta decisão substitui a proposta inicial de expandi-lo até 1.280 px e
  mantém a nova identidade visual sem perder a densidade de leitura aprovada no
  mobile.
- Exibir título “Novo relatório”, breadcrumb `RDO / Novo relatório` e a etapa atual no
  cabeçalho da página.
- Deixar módulos, conta, sair, tema e menu móvel sob responsabilidade do shell
  compartilhado, eliminando os chips locais da barra legada.

### Etapas e progresso

Criar um componente reutilizável `FormStepper` (ou `ProgressSteps`) no design system.
Ele deve mostrar número, título e estados concluído/atual/futuro, manter a navegação
existente e expor semântica acessível (`aria-current="step"` na etapa atual).

O status do rascunho fica visualmente junto ao stepper, como status secundário, sem
duplicar a barra de progresso. `DraftSaveStatus` pode receber uma aparência
`design-system`, preservando seu `role="status"`.

### Organização responsiva

| Região | Desktop (≥ 1.024 px) | Tablet (768–1.023 px) | Mobile (< 768 px) |
|---|---|---|---|
| Conteúdo | AppShell com sidebar; formulário estreito centralizado | drawer; coluna controlada | uma coluna e navegação inferior |
| Campos | grid de 2–3 colunas | grid de 2 colunas | uma coluna |
| Ações | barra sticky dentro do conteúdo | barra sticky | fixa/sticky acima da `BottomBar` e safe area |
| Modal de serviço | caixa central média | caixa central/folha | bottom sheet |
| Controles | densidade confortável | densidade compacta | 16 px de fonte e alvo ≥ 44 px |

O rodapé de ações deve manter “Voltar” e “Avançar/Enviar” sempre visíveis sem cobrir o
último campo. No mobile, precisa considerar teclado virtual, `safe-area-inset-bottom`
e a altura da `BottomBar`.

## Composição por etapa

### 1. Cabeçalho

- Card “Identificação”: projeto ocupa a parte mais larga; data fica ao lado no
  desktop/tablet. O controle “Somente serviço” permanece disponível apenas onde já é
  permitido.
- Cards “Horários” e “Equipe do dia” podem ficar lado a lado em desktop/tablet e
  empilhados no mobile.
- Condições especiais ocupam a largura total. DDS, sobreaviso e turno noturno abrem
  seus campos dentro do próprio bloco, sem novo modal ou mudança de sequência.
- Pessoas e temas selecionados usam `Badge` removível em vez das tags locais.
- Avisos de equipe, missão e conflito usam `Alert` com o tom semântico adequado.

### 2. Serviços

- Cada serviço continua expandido em um `Card` próprio; não introduzir accordion nem
  telas intermediárias.
- Cabeçalho do card: `Badge` para o tipo, título “Serviço N” e `IconButton` de remoção
  com ícone de lixeira e nome acessível.
- Campos curtos formam grid responsivo; descrições, listas, checkboxes e uploads
  ocupam a linha completa quando necessário.
- O botão de adicionar serviço abre o mesmo seletor atual, visualmente padronizado:
  `Modal` no desktop e bottom sheet no mobile. Emojis devem ser substituídos por
  `AppIcon`/ícones oficiais do design system.
- O aviso de continuidade continua antes da lista, usando `Alert`.

### 3. Finalização

- Atividades do dia e upload geral permanecem como campos principais.
- Horas extras e resumo podem ficar lado a lado no desktop quando houver espaço;
  no mobile seguem a ordem atual, em uma coluna.
- A justificativa condicional permanece logo após o resumo de horas.
- O resumo final usa `Card` de destaque sem alterar os dados apresentados.
- O envio continua sendo a ação primária; seu feedback de progresso e erro não muda.

## Mapeamento para o design system

| Legado atual | Destino |
|---|---|
| `page-card`, `admin-card-react` | `Card` |
| `<input>`, `<select>`, `<textarea>` | `Field` + `Input`/`Select`/`Textarea` |
| botões `primary`, `secondary`, `mini`, `svc-remove`, `cadd-btn` | `Button`/`IconButton` |
| `colab-tag` e tags de tema | `Badge` removível |
| avisos, hints e erros locais | `Alert` com tom semântico |
| indicador de rascunho | `StatusPill`/`Spinner` via `DraftSaveStatus` |
| rótulo do tipo de serviço | `Badge` |
| alternâncias booleanas | novo primitivo DS `Switch` |
| grupos de checkbox/radio/pílulas | novo primitivo DS de escolha/`ChoiceGroup` |
| modal local de tipos | `Modal` com apresentação mobile em bottom sheet |
| upload local | `UploadField` com aparência DS e `AppIcon` |

`FormStepper` e `Switch` foram adicionados como primitivos oficiais e são exportados
pelo design system. Os grupos de escolha permanecem na composição existente do RDO,
com estilos escopados, e o seletor de serviço usa `Modal` responsivo sem alterar o
fluxo funcional.

## Estratégia técnica sem regressão

`ServiceFields` e `UploadField` são compartilhados com a tela de detalhes do relatório.
Uma alteração visual global neles mudaria uma página que não faz parte deste escopo.
A migração deve, portanto, ser opt-in:

```tsx
<ServiceFields appearance="design-system" {...props} />
<UploadField appearance="design-system" {...props} />
```

O valor padrão continua `legacy`. `NewReportPage` ativa a nova aparência; consumidores
como `ReportDetailPage` seguem intactos até sua própria migração. O mesmo padrão pode
ser usado em blocos internos compartilhados, se necessário.

`NewReportSpecialConditions` e `ReportWorkforceNotices` só pertencem ao formulário e
podem ser migrados diretamente. As novas regras de layout devem ficar em um CSS
escopado, por exemplo `NewReportPage.ds.css`, com tokens semânticos e apenas os
breakpoints oficiais de 768, 1.024 e 1.280 px. Não adicionar mais exceções ao
`base.css`, hexadecimais, `!important` ou espaçamentos inline arbitrários.

Extrações de componentes são aceitáveis apenas como organização visual — por exemplo
`RdoFormSection`, `RdoFormActions` e `RdoServiceCard`. Estado, hooks, validação e montagem
de payload devem permanecer na página nesta fase.

## Sequência de implementação

1. **Proteção de comportamento**
   - ampliar testes de caracterização das três etapas e da variante “somente serviço”;
   - registrar contratos de foco, rolagem, autosave, uploads e campos condicionais;
   - capturar baselines visuais nos quatro grupos de viewport.
2. **Primitivos reutilizáveis**
   - implementar `FormStepper`, `Switch`/escolhas e apresentação bottom sheet;
   - adicionar aparência DS ao status de rascunho e ao upload;
   - validar componentes isoladamente e exportá-los pelo índice do DS.
3. **Shell e estrutura**
   - aplicar `.fv-ds`, `AppShell`, `PageHeader`, stepper e barra de ações;
   - manter a página funcional antes de migrar os campos internos.
4. **Cabeçalho**
   - migrar identificação, horários, equipe e condições especiais;
   - conferir DDS, sobreaviso, noturno, missão e conflitos de ausência.
5. **Serviços**
   - migrar cards e `ServiceFields` por aparência opt-in;
   - padronizar inclusão/remoção, colaborador, campos específicos e seletor de tipo.
6. **Finalização e limpeza**
   - migrar atividades, upload, horas extras, resumo e envio;
   - remover somente CSS legado comprovadamente sem consumidores;
   - executar a matriz completa de regressão, tema e responsividade.

Essa ordem permite commits pequenos e reversíveis, sem manter a tela inutilizável no
meio da migração.

## Matriz mínima de validação

### Viewports e tema

- 390 px (mobile compacto);
- 768 e 820 px (tablet/retrato e ponto crítico atual);
- 1.024 px (transição para desktop);
- 1.280 e 1.440 px (desktop amplo);
- temas claro, escuro e preferência do sistema.

### Perfis e cenários

- colaborador, coordenador e gestor;
- gestor criando RDO completo e “somente serviço”;
- projeto sem líder e tentativa de RDO duplicado;
- rascunho salvando, salvo e com falha;
- sugestão de missão, ausência e justificativa;
- DDS diurno/noturno, sobreaviso e turno noturno;
- cada um dos seis tipos de serviço;
- adicionar/remover serviço, colaborador, tema e etapa personalizada;
- upload por seletor e arrastar/soltar, remoção e restauração de foto;
- horas extras com e sem justificativa;
- envio carregando, com sucesso e com erro.

### Qualidade

- nenhuma rolagem horizontal ou micro-scroll local;
- campos mobile com fonte mínima de 16 px e alvos de toque ≥ 44 px;
- foco visível e navegação por teclado em etapas, escolhas e modal;
- ação sticky não cobre campos, alertas ou teclado virtual;
- rolagem/foco para o primeiro campo inválido continua funcionando;
- drawer, sidebar e `BottomBar` não colidem com o formulário;
- typecheck, lint, build e toda a suíte atual permanecem verdes.

## Riscos principais

| Risco | Mitigação |
|---|---|
| `ServiceFields`/`UploadField` afetam detalhes do RDO | aparência opt-in com padrão legado |
| grande matriz de campos condicionais | migrar uma etapa por vez e manter testes de caracterização |
| action bar colide com `BottomBar` ou teclado | offsets tokenizados, safe area e testes em mobile real |
| `AppShell` muda o contêiner de rolagem | testar todos os `data-invalid-target` e o foco programático |
| inputs de data/hora estouram no iOS | grid com `minmax(0, 1fr)`, largura 100% e fonte de 16 px |
| CSS legado vence os novos componentes | limite `.fv-ds`, folha escopada e remoção apenas após auditoria |
| exclusão de fotos perde estado durante refatoração | preservar `photoDeletionStaging` e mudar só o markup visual |

## Fora de escopo

- backend, endpoints, banco e payloads;
- rotas, permissões, autenticação e papéis;
- stores, hooks, debounce e regras de validação;
- cálculos de horário, equipe ou serviço;
- ordem, nome ou quantidade das etapas;
- criação de novos fluxos ou opções de formulário;
- redesign da visualização/detalhes de RDO.

## Definição de pronto

A migração visual e seu fechamento técnico estão concluídos: o formulário tem aparência e
comportamento responsivo equivalentes às páginas consolidadas, sem diferenças
funcionais observáveis, e os consumidores compartilhados fazem opt-in explícito.
Os rótulos condicionais, budgets arquiteturais e a matriz visual automatizada da
seção “Estado pós-implementação” estão concluídos; a definição de pronto original
está integralmente satisfeita. Na varredura final, os 27 arquivos de contrato do
RDO, o build, o lint, a tipagem E2E e os 16 cenários/32 capturas visuais em Chromium/Firefox
ficaram verdes, sem confirmação nativa remanescente no módulo.
