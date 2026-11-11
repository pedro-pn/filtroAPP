# Modelo de leitura

Sem novas tabelas ou transições.

- Report → Project: recorte por projeto e visibilidade API existentes.
- Report → ReportVersion: ativa mais recente; manual legado histórico quando aplicável; hashes de origem/final.
- Report → MaintenanceRecord → MaintenanceAttachment: IDs DOCUMENT aprovados e visíveis; requer escopos de manutenção para descobrir e baixar.
- Collaborator → User: userId da conta vinculada e emailCorporativo ou null. Sem conta: ambos null. Conta pessoal: userId presente, emailCorporativo null; nunca publicar o contato pessoal.
- pdf: disponivel obrigatório; versao/nomeArquivo/atualizadoEm quando há referência persistida; maintenanceAttachmentIds em manutenção.

Disponibilidade na listagem é um indicador de referência persistida, não validação de bytes. Cache só é verificado no download.
