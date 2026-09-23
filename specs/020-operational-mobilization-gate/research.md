# Research: decisões da entrega 020

## Adoção por existência do workflow

**Decision**: exigir autorização somente quando o projeto possui Gestão de Projetos iniciada.

**Rationale**: a inicialização já é explícita e auditável; projetos antigos continuam operando até serem classificados.

## Uma decisão central

**Decision**: carregar os dados do workflow e reutilizar o cálculo de gate e autorização da entrega 019.

**Rationale**: evita que Efetivo, Romaneio e Estoque implementem critérios diferentes.

## Pontos protegidos

**Decision**: proteger mudança de missão oficial para Mobilização/Execução, romaneio de saída e uso direto de estoque em projeto.

**Rationale**: esses pontos representam saída física ou seu início operacional; retornos precisam continuar livres.

## Verificação antes do efeito

**Decision**: validar o romaneio antes de gerar arquivos e repetir a proteção na integração transacional de estoque.

**Rationale**: evita arquivos órfãos e mantém defesa contra chamadas internas futuras.
