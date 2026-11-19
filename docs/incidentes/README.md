# Registros de incidentes

Um arquivo por incidente: `AAAA-MM-DD-titulo-curto.md`, criado no mesmo dia (pilar 12.4).
Também entram aqui os riscos latentes encontrados em auditoria que poderiam ter virado
incidente, para que a causa e a prevenção fiquem registradas.

Regras:

- Escrita sem culpa (*blameless*): fatos, causas e o que muda no sistema, não quem errou.
- Sem dados pessoais nem segredos (cite nomes de variáveis, nunca valores).
- Link para o PR que corrige e, se houver, para o passo do runbook usado.
- O procedimento de resposta está em [`../RUNBOOK_INCIDENTES.md`](../RUNBOOK_INCIDENTES.md).

## Modelo

```markdown
# <título curto>
- Início / detecção / fim (horários):
- Quem detectou e como (alerta, usuário, painel, auditoria):
- Impacto (quem foi afetado, o que ficou indisponível, dados perdidos?):
- Linha do tempo (o que foi feito, em ordem):
- Causa raiz:
- Correção aplicada (commit/PR):
- O que muda para não repetir (ação, responsável, prazo):
```

## Índice

| Data | Registro | Tipo |
|---|---|---|
| 2026-11-18 | [CI bloqueado por lentidão do espelho apt](2026-11-18-ci-espelho-apt-lento.md) | Incidente (entrega) |
| 2026-11-18 | [Produção sem alertas operacionais](2026-11-18-producao-sem-alertas.md) | Risco latente (auditoria) |
| 2026-11-18 | [Aplicação conectando como superusuário do banco](2026-11-18-banco-superusuario.md) | Risco latente (auditoria) |
| 2026-11-18 | [Restauração de backup nunca comprovada](2026-11-18-restore-nao-comprovado.md) | Risco latente (auditoria) |
