"""Regera a referência aprovada a partir da revisão original, antes da integração."""
from pathlib import Path
import os
import re
import subprocess

root = Path(__file__).resolve().parents[1]
originals = root / 'src/components/projects'
target = root / 'design-preview/components'
target.mkdir(exist_ok=True)

REFERENCE_REVISION = 'f7b259bc8103f1433f9fafd60a94068bce68dd33'

def source(name):
    return subprocess.check_output(['git', 'show', f'{REFERENCE_REVISION}:frontend/src/components/projects/{name}'], cwd=root, text=True)

def fold(text, header_marker, body_marker, end_marker, label, offset=0, default_open=True):
    start = text.index(header_marker, offset)
    body = text.index(body_marker, start)
    end = text.index(end_marker, body)
    header = text[start:body]
    content = text[body:end]
    opening = '' if default_open else ' defaultOpen={false}'
    return text[:start] + f'<PreviewSection label="{label}"{opening} header={{<>\n' + header + '</>}>\n' + content + '\n</PreviewSection>\n' + text[end:]

def emit(name, text, overrides=()):
    text = '// Cópia isolada para prévia. Fonte: frontend/src/components/projects/' + name + '\n' + text
    def path(match):
        spec = match.group(2)
        if not spec.startswith('.'):
            return match.group(0)
        if spec in overrides:
            return match.group(0)
        resolved = (originals / spec).resolve()
        relative = os.path.relpath(resolved, target).replace(os.sep, '/')
        return match.group(1) + relative + match.group(3)
    text = re.sub(r"((?:from\s*|import\s*(?:\(\s*)?)['\"])([^'\"]+)(['\"])", path, text)
    (target / name).write_text(text)

# Todos os controles do board e do card continuam sendo os controles atuais.
emit('ProjectCardsBoard.tsx', source('ProjectCardsBoard.tsx'), ('./ProjectDetailDashboard', './ProjectOverviewCard'))
emit('ProjectOverviewCard.tsx', source('ProjectOverviewCard.tsx'), ('./ProjectOverviewMetrics',))

# O conteúdo complementar do card fica recolhido. Barras, alertas e gestão permanecem.
s = source('ProjectOverviewMetrics.tsx')
s = "import { PreviewDisclosure } from '../PreviewDisclosure';\nimport { previewTimeFacts } from '../previewData';\n" + s
start = s.index('      {card.additionalPlannedCost')
end = s.index('\n    </div>', start)
extras = s[start:end]
s = s[:start] + s[end:]
pos = s.index('\n      <p className="acp-project__secondary">Normais:')
end = s.index('\n    </div>', pos)
hour_extras = s[pos:end]
s = s[:pos] + s[end:]
s = s.replace('  const hours = card.workedHours;', '  const hours = card.workedHours;\n  const time = previewTimeFacts(card.code);')
s = s.replace('label="Horas trabalhadas"', 'label="HH trabalhados"')
pos = s.index('\n  </div>;')
s = s[:pos] + '''
    <dl className="acp-project__pair">
      <div><dt>Dias corridos</dt><dd>{time.elapsed}</dd></div>
      <div><dt>Dias parados</dt><dd>{time.standby}</dd></div>
      <div><dt>Dias úteis</dt><dd>{time.weekdays}</dd></div>
      <div><dt>Colaboradores em obra</dt><dd>{card.collaboratorsCount}</dd></div>
    </dl>
    <PreviewDisclosure label="Detalhes do card" compact>
''' + extras + hour_extras + '\n    </PreviewDisclosure>' + s[pos:]
emit('ProjectOverviewMetrics.tsx', s, ('../PreviewDisclosure', '../previewData'))

# Os mesmos resumos financeiros e de tempo, sem alterar seus estilos.
s = source('ProjectDetailStory.tsx')
s = "import { PreviewSection } from '../PreviewSection';\nimport { previewTimeFacts } from '../previewData';\n" + s
s = s.replace('CalendarClock, Clock3,', 'CalendarClock, ClipboardList, Clock3,')
s = s.replace('data, onOpenStandbyHistory, reportsAction }: {', 'data, onOpenStandbyHistory, reportsAction, progressPanel }: {')
s = s.replace('  reportsAction?: ReactNode;', '  reportsAction?: ReactNode;\n  progressPanel?: ReactNode;')
s = s.replace("{ label: 'Standby',", "{ label: 'Dias úteis', value: `${previewTimeFacts(data.header.code).weekdays}`, sub: 'Dias úteis decorridos', percent: null, icon: CalendarClock, help: null },\n    { label: 'Standby',")
# O mesmo card de Último RDO sai da visão geral e entra no uso do tempo.
overview_source = source('ProjectDetailOverview.tsx')
rdo_start = overview_source.index('      <Card padding="sm" className="acp-overview-kpi">')
rdo_end = overview_source.index('      </Card>', rdo_start) + len('      </Card>')
rdo = overview_source[rdo_start:rdo_end].replace('className="acp-overview-kpi"', 'className="acp-overview-kpi preview-last-rdo" data-preview-last-rdo')
s = s.replace('    </div>)}</div>', '    </div>)}\n' + rdo + '\n    </div>\n    {progressPanel}', 1)
# Os nomes das seções viram os títulos principais; descrições permanecem menores.
for label, description in [
    ('Consumo de gastos', 'Quanto do previsto já foi usado'),
    ('Uso do tempo', 'Execução registrada'),
    ('Faturamento e impostos', 'Venda e notas sincronizadas'),
]:
    s = s.replace(f'<p>{label}</p><h3>{description}</h3>', f'<h3>{label}</h3><p className="preview-section-subtitle">{description}</p>')
for function, label, body_marker in [
    ('ProjectTimeSnapshot', 'Uso do tempo', '    <div className="acp-story-time-grid">'),
    ('ProjectFinancialSnapshot', 'Consumo de gastos', '    <div className="acp-story-amount">'),
    ('ProjectBillingSnapshot', 'Faturamento e impostos', '    <div className="acp-story-billing-main">'),
]:
    s = fold(s, '    <div className="acp-story-card-head">', body_marker, '  </Card>;', label, s.index('export function ' + function))
s = fold(s, '    <h4>De onde veio o custo</h4>', '    <div className="acp-story-cost-stack"', '    <ProposalContributionDetails', 'De onde veio o custo')
s = fold(s, '    <h4><HelpTip', '    {data.maioresGastos.length', '    {children}', 'Maiores gastos (Omie + estoque + manual)')
s = fold(s, '        <strong><HelpTip', '        {data.ultimosDias.length', '\n      </div>\n    </div>\n    {(onOpenStandbyHistory', 'Últimos dias')
s = s.replace('label="Uso do tempo"', 'label="Evolução"').replace('<h3>Uso do tempo</h3>', '<h3>Evolução</h3>')
emit('ProjectDetailStory.tsx', s, ('../PreviewSection', '../previewData'))

# Destaque usa a variante primária que já existe no app.
s = source('ProjectReportsDialog.tsx')
s = s.replace('variant="secondary"\n        className="acp-mission-reports-trigger"', 'variant="primary"\n        className="acp-mission-reports-trigger"')
emit('ProjectReportsDialog.tsx', s)

# A lista de notas usa o layout compacto já suportado pelo DataTable para caber
# na terceira coluna, preservando recebimento, consulta, paginação e atualizações.
s = source('ProjectInvoicesSection.tsx')
s = s.replace('ariaLabel="Histórico de notas fiscais faturadas" density="compact"', 'ariaLabel="Histórico de notas fiscais faturadas" layout="cards" density="compact"')
emit('ProjectInvoicesSection.tsx', s)

# Metas reais: histórico e regras continuam funcionando; só as colunas de consulta
# e os textos de ajuda ficam recolhidos. Os cálculos vêm do módulo de produção.
s = source('MissionWeeklyProgressPanel.tsx')
s = "import { PreviewSection } from '../PreviewSection';\nimport { PreviewDisclosure } from '../PreviewDisclosure';\n" + s
s = s.replace('      <div className="mission-weekly-progress-current">', '      <PreviewDisclosure label="Consultar a semana atual" compact><div className="mission-weekly-progress-current">').replace('      </div>\n      {draft && canManage', '      </div></PreviewDisclosure>\n      {draft && canManage')
s = s.replace('  const [showAll, setShowAll] = useState(false);', '  const [showAll, setShowAll] = useState(false);\n  const [showDetails, setShowDetails] = useState(false);')
s = s.replace('  const currentWeek = weekStartKey(corporateToday())!;', "  const currentWeek = weekStartKey(corporateToday())!;\n  const closedWithTarget = rows.filter(row => !row.inProgress && row.weekStartDate < currentWeek && ['ON_TARGET', 'ABOVE', 'BELOW'].includes(row.status));\n  const achieved = closedWithTarget.filter(row => ['ON_TARGET', 'ABOVE'].includes(row.status)).length;")
s = s.replace('className={`mission-weekly-status status-${row.status.toLowerCase()}`}>{STATUS_LABEL[row.status]}', "className={`mission-weekly-status status-${row.inProgress && row.status === 'BELOW' ? 'planned' : row.status.toLowerCase()}`}>{row.inProgress && row.status === 'BELOW' ? 'Em andamento' : ['ON_TARGET', 'ABOVE'].includes(row.status) ? 'Meta atingida' : row.status === 'BELOW' ? 'Meta não atingida' : STATUS_LABEL[row.status]}")
s = s.replace('      <strong>Meta semanal de avanço</strong>', '''      <strong>Meta semanal de avanço</strong>
      <span className="mission-weekly-status status-on_target" data-preview-weekly-wins>{achieved} de {closedWithTarget.length} semanas com meta atingida</span>''')
first_hint = re.search(r'    <p className="mission-weekly-progress-hint">.*?</p>', s).group(0)
s = s.replace(first_hint, '')
s = s.replace('      <div className="mission-weekly-progress-table"', '''      <Button size="sm" variant="secondary" workflowAppearance={workflowAppearance} aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{showDetails ? 'Recolher detalhes e edição' : 'Detalhes e edição das metas'}</Button>
      <div className="mission-weekly-progress-table"''')
s = s.replace('<th scope="col">Meta registrada</th>{canManage ?', '{showDetails ? <th scope="col">Meta registrada</th> : null}{canManage && showDetails ?')
s = s.replace('              <td data-label="Meta registrada">', '              {showDetails ? <td data-label="Meta registrada">')
s = s.replace("</div> : '—'}</td>\n              {canManage ?", "</div> : '—'}</td> : null}\n              {canManage && showDetails ?")
last_hint = re.search(r'      <p className="mission-weekly-progress-hint">Diferença.*?</p>', s).group(0)
s = s.replace(last_hint, '      <PreviewDisclosure label="Como a meta é calculada" compact>\n' + first_hint + '\n' + last_hint + '\n      </PreviewDisclosure>')
s = fold(s, '    <header className="mission-weekly-progress-head">', '    {targetsQuery.isPending', '    <ConfirmDialog ', 'Meta semanal de avanço')
emit('MissionWeeklyProgressPanel.tsx', s, ('../PreviewSection', '../PreviewDisclosure'))

# O gráfico entra abaixo dos indicadores de tempo. A composição passa a ser um
# terceiro card independente, mantendo seus cálculos e os mesmos filtros.
s = overview_source
chart_start = s.index('      <Card padding="sm" className="acp-overview-chart">')
chart_end = s.index('      </Card>', chart_start) + len('      </Card>')
chart = s[chart_start:chart_end]
chart = chart.replace('<p className="acp-overview-kicker">Evolução</p><h3>Histórico do avanço</h3>', '<h3>Histórico do avanço</h3>')
chart = fold(chart, '        <div className="acp-overview-card-head">', '        <ProgressHistoryChart', '      </Card>', 'Histórico do avanço')
service_start = s.index('    <div className="acp-overview-services"')
service_end = s.index('\n    <div className="acp-overview-next">', service_start)
service = s[service_start:service_end].replace('<p className="acp-overview-kicker">Composição</p><h2>Avanço por serviço</h2>', '<h3>Composição do avanço</h3><p className="preview-section-subtitle">Avanço por serviço</p>')
service = service.replace('<p>Percentuais calculados para o recorte selecionado.</p>', '')
service = fold(service, '      <div><h3>Composição do avanço', '      {serviceCards.length', '\n    </div>', 'Composição do avanço')
logic_start = s.index('  const groupedServices =')
logic_end = s.index('  const firstAlert =', logic_start)
service_logic = s[logic_start:logic_end]
s = "import { PreviewSection } from '../PreviewSection';\n" + s[:s.index('export function ProjectDetailOverview')].replace(
    'import { Activity, ArrowUpRight, CalendarClock, ClipboardList, Gauge, HardHat, Truck, UsersRound, Wallet, TriangleAlert }', 'import { HardHat }'
).replace("import { MissionWeeklyProgressSummaryCard } from './MissionWeeklyProgressSummaryCard';\n", '').replace(
    'brl, fmtDate, fmtPct, physicalUnit, SERVICE_LABELS, UNIT_LABELS, weeklyPhysicalProgress', 'fmtPct, physicalUnit, SERVICE_LABELS, UNIT_LABELS'
) + '''export function ProjectDetailOverview({ progressHistory, chartKey, filterLabel, filters }: OverviewProps) {
  return <div className="acp-overview preview-evolution" data-acp-project-overview>
    {filters ? <div className="preview-evolution-filters">{filters}</div> : null}
    <div className="acp-overview-main">
''' + chart + '''
    </div>
  </div>;
}

export function ProjectDetailServiceComposition({ target, fallbackProgress, fallbackServices }: OverviewProps) {
''' + service_logic + '''
  return <Card padding="sm" className="preview-services" data-preview-service-composition>
''' + service + '''
  </Card>;
}
'''
emit('ProjectDetailOverview.tsx', s, ('../PreviewSection',))

# O dashboard inteiro é reaproveitado. Movemos os resumos já existentes para o
# início e recolhemos os blocos atuais de consulta, mantendo seus controles.
s = source('ProjectDetailDashboard.tsx')
s = "import { PreviewSection } from '../PreviewSection';\n" + s
s = s.replace('import { ProjectDetailOverview }', 'import { ProjectDetailOverview, ProjectDetailServiceComposition }')
s = s.replace('Pessoas, equipamentos e escopo', 'Equipamentos e escopo')
s = s.replace(', ProjectTimelineCard', '')
s = s.replace('data: planningContext, isLoading: planningContextLoading, isError: planningContextError, refetch: refetchPlanning', 'data: planningContext')
start = s.index('      <ProjectTimeSnapshot\n')
end = s.index('\n      <div className="acp-detail-cols">', start)
time = s[start:end]
s = s[:start] + s[end:]
start = s.index('          <ProjectFinancialSnapshot data={data}>')
end = s.index('          </ProjectFinancialSnapshot>', start) + len('          </ProjectFinancialSnapshot>')
financial = s[start:end]
s = s[:start] + s[end:]
start = s.index('      <ProjectDetailOverview\n')
end = s.index('\n      {weeklyTargetOwner ? <Card', start)
overview = s[start:end]
composition = overview.replace('<ProjectDetailOverview', '<ProjectDetailServiceComposition', 1)
time = time.replace('      <ProjectTimeSnapshot\n', '      <ProjectTimeSnapshot\n        progressPanel={\n' + overview + '\n        }\n', 1)
s = s[:start] + '      <div className="preview-priorities">\n' + financial + '\n' + time + '\n' + composition + '\n      </div>\n' + s[end:]
# Colaboradores ficam visíveis logo após evolução, antes da meta semanal.
people_start = s.index('      <ProjectDetailPeople ')
people_end = s.index('\n', people_start)
people = s[people_start:people_end]
s = s[:people_start] + s[people_end:]
weekly_start = s.index('      {weeklyTargetOwner ? <Card')
weekly_end = s.index('      <div className="acp-detail-section-head" id="acp-execution">')
weekly_block = s[weekly_start:weekly_end]
s = s[:weekly_start] + s[weekly_end:]
# Remove a seção de prazos/planejamento solicitada, mantendo o editor do topo.
start = s.index('      <div className="acp-detail-section-head" id="acp-execution">')
end = s.index('      <div className="acp-detail-cols">', start)
s = s[:start] + people + '\n\n' + weekly_block + s[end:]
# Faturamento, impostos e notas passam a compartilhar um único card financeiro.
start = s.index('      <div className="acp-detail-cols">')
end = s.index('      <div className="acp-detail-section-head" id="acp-quality">', start)
s = s[:start] + '''      {data.canViewProjectFinancials ? <Card padding="sm" className="preview-financial" id="acp-financial">
        <div className="acp-detail-section-head">
          <p>Financeiro</p><h2>Gastos e retorno</h2>
          <span>Faturamento, impostos e notas fiscais do projeto.</span>
        </div>
        <div className="preview-financial-grid" data-preview-financial-grid>
          <ProjectBillingSnapshot data={data} />
          <ProjectDetailTaxes data={data} />
          <ProjectInvoicesSection key={groupId || projectId} projectId={projectId} groupId={groupId} division={data.division} />
        </div>
      </Card> : null}

''' + s[end:]
s = fold(s, '        <div className="acp-detail-section-head">', '        <div className="preview-financial-grid"', '      </Card> : null}', 'Gastos e retorno', s.index('<Card padding="sm" className="preview-financial"'))
# Também ficam recolhíveis os custos manuais e as notas da gestão.
s = fold(s, '                <div className="acp-detail-manual-costs-head">', '                {manualCosts.length > 0 ? (', '\n              </div>\n            ) : null}', 'Custos manuais')
s = fold(s, '          <div className="acp-detail-notes-head">', '          {canManageProjectNotes ? (', '\n        </Card>\n      ) : null}', 'Notas da gestão')
# Qualidade e gestão e Recursos e rastreabilidade mantêm os cabeçalhos fixos.
# Apenas seus cards brancos (desvios, notas, equipamentos e avanço diário)
# preservam os controles individuais de recolher/expandir.
emit('ProjectDetailDashboard.tsx', s, ('./ProjectDetailOverview', './ProjectDetailStory', './MissionWeeklyProgressPanel', './ProjectReportsDialog', './ProjectInvoicesSection', '../PreviewSection'))
print('Referência aprovada gerada a partir da revisão original. Nenhum arquivo de produção foi alterado.')
