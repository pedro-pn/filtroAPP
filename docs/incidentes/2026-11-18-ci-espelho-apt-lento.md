# CI bloqueado por lentidão do espelho apt da Ubuntu

- **Início / detecção / fim:** 2026-11-18, ~15h–16h (horário de Brasília); detectado pelo CI vermelho em PRs e na `main`; corrigido pelo PR #602.
- **Quem detectou e como:** falhas repetidas do job `Frontend` (passo "Install Chromium…") e do job `Backend` (passo "Install Hunspell pt-BR") com `has timed out after 5 minutes`.
- **Impacto:** nenhum para usuários. Merges bloqueados por horas: `Frontend` e `Backend` são checks obrigatórios da `main`; a própria `main` ficou vermelha em 2 execuções (runs 44365925165 e 44367594876). Várias novas tentativas manuais.
- **Linha do tempo:** falhas no #592, #596 e #597 → novas tentativas (`gh run rerun --failed`) passam às vezes → diagnóstico nos logs: download a ~1 min por pacote do espelho `us-east-2.ec2.archive.ubuntu.com` → PR #602.
- **Causa raiz:** os dois passos instalam pacotes `.deb` a cada execução (fontes e mesa via `playwright install --with-deps`; `hunspell-pt-br`), dependentes de um espelho externo lento, com limite de 5 minutos e só 1 nova tentativa do apt. Falha instável tratada com "rodar de novo" (régua 2.3).
- **Correção aplicada:** PR #602 — cache do Chromium (`~/.cache/ms-playwright`) e dos `.deb` (`~/apt-archives`) por versão, limite de 15 minutos e `Acquire::Retries 3` nos dois jobs.
- **O que muda para não repetir:** passos que baixam pacotes do sistema no CI usam cache e prazo com folga; falha instável vira registro aqui e correção na causa.
