# Data model

ProjectDatabook: id, projectId FK Restrict, familyId UUID, revision inteiro (unique familyId/revision), title, startDate/endDate @db.Date, options JSON, snapshot JSON, sourceFingerprint, createdByUserId (identificador de auditoria), createdByName (snapshot), status PENDING/RUNNING/FAILED/COMPLETED, progress 0..100, attempts, lockedAt, leaseToken, error, pdfPath/zipPath e SHA-256, completedAt/createdAt/updatedAt.

Transições: create→PENDING; claim CAS→RUNNING; heartbeat mantém lease; finalize com token→COMPLETED; falha→FAILED; retry explícito→PENDING. RUNNING com lease vencido pode ser reclamado; token antigo não finaliza. COMPLETED nunca muda; nova revisão recebe nova linha e novo snapshot. Revisão próxima calculada em transação com lock da família/projeto; família obrigatoriamente pertence ao mesmo projeto.

Snapshot: identificação pública do projeto, período/etapa, resumos de relatórios/serviços/assinaturas, fotos selecionadas, produtos confirmados/documentos selecionados, avisos e referências. options contém somente IDs/chaves e campos de curadoria; nenhum path recebido do usuário é resolvido. Arquivos originais manifestados com hashes. Relatórios/fotos só dentro da seleção/período; FDS vinculada ao produto escolhido; documentos técnicos vinculados ao projeto. Fingerprint detecta mudança de fontes durante emissão.
