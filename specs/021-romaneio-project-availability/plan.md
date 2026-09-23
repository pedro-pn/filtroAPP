# Implementation Plan: obras disponíveis no romaneio

**Branch**: `feat/016-gestao-projetos-efetivo` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

## Summary

Tornar a listagem de projetos do romaneio sensível ao tipo. A Saída reutiliza a decisão central de autorização e aceita legado somente ativo; a Entrada consulta todas as obras acessíveis. A tela troca a consulta junto com o tipo e não permite cadastrar missão durante uma saída.

## Technical Context

**Language/Version**: Node.js 22, JavaScript ESM, TypeScript/React 19
**Dependencies**: Express 5, Prisma 7.9, Zod, TanStack Query, driver.js
**Storage**: modelos existentes; nenhuma migration
**Testing**: `node --test`, testes estáticos, ESLint, Vite build e arquitetura
**Constraints**: preservar regras de acesso; não expor checklist/workflow na resposta; sem servidor, Docker ou deploy

## Constitution Check

- O contrato de consulta será validado por Zod e a decisão final permanecerá no backend.
- A regra de autorização existente será reutilizada para evitar divergência entre lista e gravação.
- A interface permanece responsiva, em pt-BR e usa os controles atuais.
- A campanha temporária será válida por dez dias corridos, até 19/09/2026.
- Não há alteração de banco nem operação de infraestrutura.

## Design

1. Separar a decisão pura baseada no workflow da consulta unitária já existente.
2. Consultar os workflows junto com os projetos apenas para Saída e filtrar em memória, pois a validade exige comparação de versão e cálculo completo do gate.
3. Para Entrada, consultar todas as obras não excluídas que o usuário pode acessar.
4. Validar novamente a Saída no momento de gravar, incluindo o estado ativo do legado.
5. Chavear o cache do frontend pelo tipo e limpar projeto/itens ao alternar.
