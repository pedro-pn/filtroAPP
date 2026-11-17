# Retorno do FiltroAPP — encerramento da homologação em 17/11/2026

Coleta funcional concluída na VPS em 17/11, das 15:18 às 15:24, e encerramento confirmado às 15:48, horário de São Paulo. **As duas provas funcionais e a revogação de A/B passaram. A homologação funcional está encerrada no staging.**

- **Troca A → B:** A leu 100 eventos em quatro páginas; B continuou por 42 páginas. Os 1.141 eventos coincidem integralmente, na mesma ordem e sem repetição, com a leitura completa feita apenas com B.
- **Isolamento:** A abre/lê o próprio snapshot; B recebe `404 NOT_FOUND` ao tentar lê-lo. O watermark desse snapshot funciona normalmente no feed com B.
- **Evidências:** PDFs ativos A e B v2 baixados com MIME, tamanho e SHA-256 corretos; B v1 retorna `410 EVIDENCE_SUPERSEDED`; C retorna `410 EVIDENCE_REVOKED`; D retorna `404 NOT_FOUND`. O ASO do fixture também não é disponibilizado.
- **Expiração real:** o link de A venceu às 15:23:38 e foi recusado às 15:23:53 com `400 InvalidJWT`. Um novo link solicitado com B permitiu baixar o mesmo PDF novamente com o hash correto.
- **FiltroAPP:** os quatro envelopes finais estão na revisão 3 e em `APPLIED`, com metadados/estados corretos no serviço de conformidade. Há 1.136 recibos aplicados, 3 substituídos e nenhum pendente. O worker está concluindo os ciclos sem erro.

Foram aprovadas 35 verificações: 30 funcionais e cinco do encerramento. A credencial instalada `cnt_4QhymN` e o cursor do worker permaneceram iguais antes/depois da coleta funcional. O teste usou consumidores isolados; não substituiu a configuração corrente. Tokens e URLs assinadas não constam da evidência compartilhável.

**Revogação confirmada pelo FiltroAPP às 15:48:19:** A (`cnt_jW8XhK`, ID `f5521ec9-b104-42c7-ac87-e5e6f776cab4`) e B (`cnt_EMEFkM`, ID `c70e83e9-1eb7-47ea-93ea-b94ee85d6087`) respondem `401 UNAUTHORIZED`, com `requestId` consistente no corpo e cabeçalho. A credencial original responde `200` e continua instalada. Os três ciclos recentes do worker concluíram sem erro; não há agregados pendentes.

Não é necessário repetir o lote ou preparar novos casos funcionais. Não restam pendências desta rodada de homologação no staging. A limpeza posterior dos fixtures fictícios fica separada do aceite dos testes.

Referências no FiltroAPP: `docs/HOMOLOGACAO_CONECTA_RH_PROVAS_FINAIS_20261117_RESULTADO.md` e `docs/evidence/conecta-rh-provas-finais-20261117.json`.
