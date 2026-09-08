import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

test('reducer move cartão entre colunas e snapshot permite rollback', async () => {
  const kanban = await load('/src/utils/missionKanban.ts');
  const mission = { id: 'm1', stage: 'STANDBY', kanbanOrder: 0 };
  const columns = kanban.missionsToColumns([mission]);
  const snapshot = kanban.cloneMissionColumns(columns);
  const moved = kanban.moveMissionInColumns(columns, 'm1', 'EXECUTION', 0);
  assert.equal(moved.STANDBY.length, 0);
  assert.equal(moved.EXECUTION[0].id, 'm1');
  assert.equal(snapshot.STANDBY[0].id, 'm1');
});

test('soltar em outra coluna usa o alvo destacado e não depende da prévia ao vivo', async () => {
  const kanban = await load('/src/utils/missionKanban.ts');
  const columns = kanban.missionsToColumns([
    { id: 'm1', stage: 'STANDBY', kanbanOrder: 0 },
    { id: 'm2', stage: 'EXECUTION', kanbanOrder: 0 },
    { id: 'm3', stage: 'EXECUTION', kanbanOrder: 1 }
  ]);
  assert.equal(kanban.missionStage(columns, 'm1'), 'STANDBY');
  assert.deepEqual(kanban.resolveKanbanDrop(columns, 'm1', 'EXECUTION', { stage: 'EXECUTION', order: 1 }), { sameColumn: false, order: 1 });
  assert.deepEqual(kanban.resolveKanbanDrop(columns, 'm1', 'EXECUTION', null), { sameColumn: false, order: 2 });
  assert.deepEqual(kanban.resolveKanbanDrop(columns, 'm1', 'EXECUTION', { stage: 'FINISHED', order: 0 }), { sameColumn: false, order: 2 });
  assert.deepEqual(kanban.resolveKanbanDrop(columns, 'm3', 'EXECUTION', null), { sameColumn: true, order: 1 });
});

test('cartão arrastado não é remontado em outra coluna durante o arraste', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  // A prévia ao vivo só pode acontecer dentro da própria coluna: remontar o cartão em outra
  // coluna mata o arraste nativo e o `dragend` nunca chega para limpar o estado.
  assert.match(source, /if \(missionStage\(columns, missionId\) === stage\) \{\s*[\s\S]{0,200}?liveMove\(/);
  assert.doesNotMatch(source, /onDragOver=\{[\s\S]{0,200}?liveMove\(/);
  // Soltar encerra o arraste na hora, sem depender do evento dragend.
  assert.match(source, /function dropOnStage[\s\S]{0,700}?endDrag\(\);/);
  assert.match(source, /onDrop=\{event => \{\s*event\.preventDefault\(\);\s*dropOnStage\(stage\);/);
});

test('kanban mostra pendentes no Stand by e só libera arraste após dados obrigatórios', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  assert.match(source, /listPendingMissionProjects/);
  assert.match(source, /stage === 'STANDBY' \? pendingProjects\.map/);
  assert.match(source, /mission\.scheduleStatus === 'CONFIRMED' && missionPendencies\(mission\)\.length === 0/);
  assert.match(source, /setFormTarget\(\{ mission: null, project \}\)/);
});

test('cada etapa usa rolagem local e o arraste rola a lista da coluna', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(source, /closest<HTMLElement>\('\.efetivo-kanban-list'\)/);
  assert.match(css, /\.efetivo-kanban-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});

test('desktop oculta Mover para e mobile mantém o seletor', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/pages/efetivo/efetivo.css', import.meta.url), 'utf8');
  assert.match(css, /\.efetivo-kanban-card \.efetivo-kanban-move-select \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.efetivo-kanban-card \.efetivo-kanban-move-select \{ display: flex; \}/);
});

test('concluir pelo kanban solicita desmobilização opcional e sincronizada', async () => {
  const fs = await import('node:fs');
  const kanban = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  const modal = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionCompletionModal.tsx', import.meta.url), 'utf8');
  assert.match(kanban, /mission\.stage !== 'FINISHED' && stage === 'FINISHED'/);
  assert.match(kanban, /MissionCompletionModal/);
  assert.match(modal, /Data de desmobilização/);
  assert.match(modal, /Opcional\./);
  assert.match(modal, /sincronizada com o cronograma do Planejamento/);
});

test('canceladas ficam em coluna própria oculta por toggle', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  assert.match(source, /const \[showCancelled, setShowCancelled\] = useState\(false\)/);
  assert.match(source, /mission\.scheduleStatus !== 'CANCELLED'/);
  assert.match(source, /Mostrar canceladas/);
  assert.match(source, /showCancelled \? <div className="efetivo-kanban-column efetivo-cancelled-column/);
  assert.match(source, /data-kanban-status="CANCELLED"/);
});

test('cards do kanban abrem a gestão da equipe e dos ciclos', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../src/pages/efetivo/components/MissionKanban.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ MissionAllocationModal \}/);
  assert.match(source, /const \[allocating, setAllocating\] = useState<PlanningMission \| null>\(null\)/);
  assert.match(source, /setAllocating\(mission\); \}\}>Equipe e ciclos<\/button>/);
  assert.match(source, /<MissionAllocationModal mission=\{allocating\}/);
});
