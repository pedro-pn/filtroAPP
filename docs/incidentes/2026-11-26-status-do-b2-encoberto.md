# Falha na cópia externa (B2) ficaria escondida pelo backup local

- **Início / detecção / fim:** o risco existia desde que a cópia local passou a rodar várias vezes
  ao dia. Foi detectado em 26/11/2026, na reanálise dos 13 pilares (critério 3.5), e corrigido no
  mesmo dia.
- **Quem detectou e como:** auditoria. O `backup-latest.json` de produção às 13h UTC mostrava
  `"b2Configured": false`, porque era da cópia local. O diário que envia ao B2 é o das 02h.
- **Impacto:** nenhum dado perdido, porque o diário do B2 seguia rodando. O risco era o envio ao
  B2 parar sem que o painel de Operações nem os alertas percebessem.
- **Causa raiz:** todas as rotinas gravam o mesmo `backup-latest.json`, e o painel e o alerta
  só olham a idade e o status da **última** execução. A cópia local roda às 00h, 03h, 08h, 13h,
  18h e 23h, e cada uma regrava o arquivo com `SUCCESS`; assim, um diário com falha nunca
  ficava "velho". Agravante: com `B2_URI` definido e sem o comando `b2` no servidor, o script
  só avisava no log e terminava com `SUCCESS`.
- **Correção aplicada:** as rotinas com `B2_URI` passam a gravar um status próprio,
  `offsite-latest.json`. O backend o lê, e `FAILURE` ou mais de 26 h sem cópia geram problema e
  alerta. A falta do `b2` agora é falha. Veja "Status da cópia externa (B2)" em
  [deploy/BACKUP.md](../../deploy/BACKUP.md).
- **O que muda para não repetir:** cada destino de backup tem o próprio status monitorado. Uma
  rotina nova de backup que envie para outro lugar precisa de um status próprio.
