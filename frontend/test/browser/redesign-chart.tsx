import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProgressHistoryChart } from '../../src/components/projects/ProjectDetailHistory';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';
import '../../src/components/projects/ProjectDetailDashboard.ds.css';

// Dates close together inside a long combined history reproduced overlapping bars.
const points = [
  { date: '2025-01-01', progressPct: 0 },
  { date: '2026-09-01', progressPct: 10 },
  { date: '2026-09-02', progressPct: 20 },
  { date: '2026-09-03', progressPct: 30 },
  { date: '2026-09-10', progressPct: 60 },
  { date: '2026-10-02', progressPct: 100 }
];
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <main className="fv-ds" style={{ maxWidth: 1000, margin: '24px auto', padding: 16 }}>
    <h1>Histórico agrupado de avanço</h1>
    <ProgressHistoryChart points={points} height={200} />
  </main>
</React.StrictMode>);
