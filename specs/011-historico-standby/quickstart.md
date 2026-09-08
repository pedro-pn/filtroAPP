# Quickstart: Validar histórico de standby por projeto

## Pré-requisitos

- Dependências do backend e frontend já instaladas.
- Banco local configurado com pelo menos um projeto que possua:
  - um relatório com standby positivo, motivo e colaboradores;
  - um relatório sem standby;
  - opcionalmente um standby legado sem motivo ou efetivo.
- Usuário local autenticado com acesso ao módulo de Acompanhamento.

## Validação automatizada

### Backend focal

```bash
cd backend
node --test test/acompanhamento-standby-history.test.js
```

Resultado esperado: filtro de dias sem standby, agregação diária, ordenação, motivo, efetivo e exclusão de relatórios derivados passam.

### Regressão do backend

```bash
cd backend
npm test
```

### Frontend e campanha de novidade

```bash
cd frontend
npm test
npm run build
```

Resultado esperado: campanha fica individual por usuário/navegador até 2026-09-04 e o TypeScript/Vite compilam o diálogo e o contrato da API.

## Validação funcional

1. Abrir Acompanhamento → Projetos e confirmar que os cards externos não exibem o botão de histórico.
2. Abrir um projeto individual e localizar o botão `Ver histórico` junto ao resumo `Standby` do dashboard.
3. Acionar o botão e verificar que o dashboard permanece aberto sob o diálogo.
4. Confirmar no diálogo o código/nome do projeto e as colunas `Dia`, `Horas em standby`, `Nº de colaboradores` e `Motivo`.
5. Verificar que dias sem standby não aparecem e que as linhas estão do dia mais recente para o mais antigo.
6. Abrir um projeto sem standby e confirmar a mensagem de histórico vazio.
7. Simular indisponibilidade da API e confirmar mensagem de erro, botão `Tentar novamente` e fechamento normal.
8. Fechar por `Fechar`, pelo ícone e por Escape; confirmar que o foco volta ao botão do dashboard.
9. Repetir em 320 px e 640 px: cada linha deve virar bloco empilhado, motivos devem quebrar e a página não pode ganhar rolagem horizontal.
10. Confirmar que cards externos e dashboards de agrupamento não exibem o botão de histórico individual.

## Contrato relacionado

Ver [project-standby-history-api.md](./contracts/project-standby-history-api.md).
