# Validação planejada

Este documento não implica que o conector já exista. Usar ambiente isolado e dados sintéticos. Servidores, migrations aplicadas e deploy são executados pelo operador conforme constitution.

1. Homologar contrato e empresas, obter token de teste com escopos mínimos; credencial sem escopo ou de outra empresa deve ser rejeitada.
2. Rodar diagnóstico dry-run contra snapshot: colaboradores existentes ativos/inativos, IDs, matrículas/CPF conflitantes e cargos por normalização. Conferir que nada foi escrito.
3. Publicar cargo e admissão; reenviar envelope e repetir pelo feed. Conferir uma pessoa/vínculo/histórico e receiptId estável. Mesmo eventId com outro corpo deve falhar 409.
4. Comparar Técnico Mecânico com TECNICO  MECANICO: mapear ao mesmo cargo. Operador I e II continuam distintos. Abreviação potencialmente equivalente fica pendente e, após resolução única, dependentes são aplicados automaticamente.
5. Inverter ordem de pessoa/cargo e role_change; reiniciar worker após recepção e durante projeção. Nenhum evento se perde nem duplica.
6. Cargo muda no dia 15 e é recebido dia 20: dia 14 usa cargo anterior, dia 15 usa novo. Revisão da ocorrência corrige data; cancelamento restaura linha do tempo. Duas ocorrências ativas no mesmo dia ficam pendentes.
7. Agendar mudança/desligamento futuro, avançar relógio controlado em teste e validar projeção local. Desligamento impede alocação depois do último dia elegível e sinaliza missões sem excluir histórico. Recontratação usa pessoa existente e novo vínculo. Testar saída da classificação operacional.
8. Revogar/vencer certificado: prontidão é recalculada, confirmação atingida reabre, autorização é reavaliada; card não avança sozinho. Validar documento sem prazo versus validade desconhecida, evidência expirada e falha da origem.
9. Interromper webhook, mudar dados, consumir feed e comprovar recuperação. Expirar cursor e usar snapshot + watermark sem perder mudança durante paginação. Não inferir desligamento por ausência.
10. Executar modo simulação pela infraestrutura existente: diagnóstico sem inbox persistida, job, cursor ou alteração de domínio.
11. Testar limites, backoff, quota, logs sem dados sensíveis, replay e painel mobile/desktop. Conferir que Ponto Mais, EPI, RDO e custo histórico mantêm vínculos e snapshots.

Regressões existentes a executar na implementação:

```bash
cd backend
node --test test/collaborator-job-role-history.test.js test/collaborator-job-role-service.test.js test/collaborator-job-role-backfill.test.js test/collaborators.test.js test/efetivo-collaborators.test.js test/pontomais-sync.test.js
npm test
```

Acrescentar testes específicos de inbox, projeção, histórico/correções, recontratação, classificação, identidade e conciliação, conformidade, simulação, escopos/empresa, cursor/snapshot e recuperação. Validar migration/backfill e build frontend quando houver implementação. Planejamento documental verificado com git diff --check.

## Cenários salariais adicionais

- Cargo com salário 3.000 até 31/10 e 3.500 a partir de 01/11: consultar ambos os períodos e comprovar que reajuste futuro não é antecipado. Trocar cargo no meio do mês e cruzar a vigência do cargo com a da tabela.
- Reenviar/corrigir/cancelar ocorrência salarial: não duplicar versões, preservar auditoria e recalcular somente intervalos afetados. Conjuntos de benefícios criados antes/depois do reajuste não restauram salarioBase antigo nem perdem seus próprios valores.
- Ausência não vira zero; zero explícito tem semântica própria; salário negativo/precisão inválida é rejeitado. Cargo não mapeado, perfil ausente e tabelas incompatíveis ficam pendentes.
- Token sem rh.conecta.salarios.write não recebe evento salarial; catálogo/status/logs sem permissão salarial não revelam valor. Regressão obrigatória: backend/test/integration-job-role-salary.test.js.
