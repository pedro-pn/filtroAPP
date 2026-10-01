import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectProposalPercentageField } from '../../src/components/projects/ProjectProposalPercentageField';
import '../../src/styles/variables.css';
import '../../src/styles/base.css';
import '../../src/components/projects/ProjectScheduleEditor.ds.css';

function Fixture() {
  const [value, setValue] = useState('70');
  return <main className="fv-ds acp-schedule-ds" style={{ width: 'min(100% - 32px, 760px)', margin: '24px auto' }}>
    <h1>Editar cronograma</h1>
    <ProjectProposalPercentageField projectId="example" value={value} canManage onChange={setValue} rows={[
      { label: 'Custo', value: 100000, unit: 'BRL' },
      { label: 'Receita', value: 200000, unit: 'BRL' },
      { label: 'Dias corridos', value: 24, unit: 'dias' },
      { label: 'Dias trabalhados', value: 18, unit: 'dias' },
      { label: 'Horas normais', value: 120, unit: 'h' },
      { label: 'Horas extras', value: 20, unit: 'h' }
    ]} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
