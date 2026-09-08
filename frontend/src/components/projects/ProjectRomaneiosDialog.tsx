import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getMissionGroupRomaneios, getProjectRomaneios } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Data não informada';
}

function formatQuantity(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : String(value);
}

export function ProjectRomaneiosDialog({ projectId, groupId, missionLabel }: {
  projectId?: string;
  groupId?: string;
  missionLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const query = useQuery({
    queryKey: ['project-romaneios', groupId ? 'group' : 'project', groupId || projectId],
    queryFn: () => groupId ? getMissionGroupRomaneios(groupId) : getProjectRomaneios(projectId!),
    enabled: open && Boolean(groupId || projectId),
    staleTime: 0
  });
  const romaneios = query.data?.romaneios ?? [];
  const itemCount = romaneios.reduce((total, romaneio) => total + romaneio.items.length, 0);

  return (
    <>
      <button type="button" className="mini-btn alt" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Ver itens dos romaneios
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabelledBy={titleId}
        ariaDescribedBy={descriptionId}
        panelClassName="modal-card acp-manage-card acp-romaneios-modal"
      >
        <div className="acp-manage">
          <header className="acp-manage-head">
            <div>
              <h2 className="sec" id={titleId}>Itens dos romaneios</h2>
              <p className="acp-romaneios-context">{missionLabel}</p>
            </div>
            <button type="button" className="mini-btn alt" onClick={() => setOpen(false)} aria-label="Fechar itens dos romaneios">
              Fechar
            </button>
          </header>
          <div className="acp-manage-body">
            <p className="acp-romaneios-context" id={descriptionId}>
              Todos os itens registrados, separados por romaneio de saída ou entrada.
            </p>
            {query.isLoading ? (
              <div className="placeholder-copy" role="status">Carregando romaneios…</div>
            ) : query.isError ? (
              <div className="acp-romaneios-feedback" role="alert">
                <span>Não foi possível carregar os romaneios.</span>
                <button type="button" className="mini-btn alt" disabled={query.isFetching} onClick={() => void query.refetch()}>
                  {query.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
                </button>
              </div>
            ) : romaneios.length === 0 ? (
              <div className="placeholder-copy" role="status">
                {groupId ? 'Nenhum romaneio registrado para as missões deste grupo.' : 'Nenhum romaneio registrado para este projeto.'}
              </div>
            ) : (
              <>
                <p className="acp-romaneios-total">
                  {romaneios.length} romaneio{romaneios.length === 1 ? '' : 's'} · {itemCount} ite{itemCount === 1 ? 'm listado' : 'ns listados'}
                </p>
                {romaneios.map(romaneio => (
                  <section className="acp-romaneio" key={romaneio.id} aria-labelledby={`${titleId}-${romaneio.id}`}>
                    <header className="acp-romaneio-head">
                      <div>
                        <h3 id={`${titleId}-${romaneio.id}`}>
                          {romaneio.type === 'OUTBOUND' ? 'Saída' : 'Entrada'} · {formatDate(romaneio.romaneioDate)}
                        </h3>
                        <p>Missão {romaneio.project.code}{romaneio.project.name ? ` — ${romaneio.project.name}` : ''}</p>
                      </div>
                      {romaneio.vehiclePlate ? <span>Placa: {romaneio.vehiclePlate}</span> : null}
                    </header>
                    {romaneio.items.length === 0 ? (
                      <p className="placeholder-copy acp-romaneio-empty">Este romaneio não possui itens.</p>
                    ) : (
                      <table className="acp-romaneio-table">
                        <caption className="sr-only">Itens da missão {romaneio.project.code}, {romaneio.type === 'OUTBOUND' ? 'saída' : 'entrada'} em {formatDate(romaneio.romaneioDate)}</caption>
                        <thead>
                          <tr><th scope="col">Código</th><th scope="col">Item</th><th scope="col">Categoria</th><th scope="col">Quantidade</th></tr>
                        </thead>
                        <tbody>
                          {romaneio.items.map(item => (
                            <tr key={item.id}>
                              <td data-label="Código">{item.itemCode || '—'}</td>
                              <td data-label="Item">
                                <span>{item.itemName}</span>
                                {item.isCustom ? <small>Item personalizado</small> : null}
                                {item.isExtra ? <small>Entrada extra</small> : null}
                              </td>
                              <td data-label="Categoria">{item.categoryName || '—'}</td>
                              <td data-label="Quantidade">{formatQuantity(item.quantity)} {item.unitLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
