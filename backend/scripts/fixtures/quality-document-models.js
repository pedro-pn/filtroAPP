const exampleNote = 'EXEMPLO COM DADOS FICTÍCIOS. Documento destinado exclusivamente à avaliação do modelo pelo cliente.';
const leader = { name: 'Alex Exemplo', role: 'Líder de operações' };
const collaborators = [
  { id: 'example-leader', name: 'Alex Exemplo', role: 'Líder de operações', shift: 'Diurno' },
  { id: 'example-technician', name: 'Bruna Exemplo', role: 'Técnica de serviços', shift: 'Diurno' },
  { id: 'example-assistant', name: 'Caio Exemplo', role: 'Auxiliar de serviços', shift: 'Diurno' }
];
const tubes = [{ d: '2', c: '24', unit: 'pol', lengthUnit: 'm' }, { d: '3', c: '18', unit: 'pol', lengthUnit: 'm' }];

export function qualityDocumentModelReports() {
  const common = {
    sequenceNumber: 1,
    reportDate: '2026-10-06',
    project: {
      code: 'MODELO-001',
      name: 'Serviços industriais',
      clientName: 'Cliente Exemplo (dados fictícios)',
      clientCnpj: '00000000000100',
      location: 'Unidade Industrial Exemplo - Área 01',
      contractCode: 'PROP-EXEMPLO-001',
      operator: leader
    },
    specialConditions: { __leaderSnapshot: leader, resolvedCollaborators: collaborators }
  };
  const serviceData = {
    'Equipamento(s)': 'Conjunto hidráulico EQ-EX-01',
    Sistema: 'Circuito de alimentação SIS-EX-01',
    'Hora de início': '08:00',
    'Hora de término/pausa': '16:00',
    'Diâmetros e comprimentos': tubes,
    'Colaboradores do serviço': collaborators.map(collaborator => collaborator.name),
    'Desenhos / TAGs': 'DES-EX-001 / LIN-EX-01 / LIN-EX-02',
    'Aprovado pelo cliente?': 'Sim'
  };
  const rcpuData = {
    ...serviceData,
    'Tipo de flushing': 'Primário',
    'Flushing em tubulação?': 'Sim',
    'Tipo de óleo': 'Óleo hidráulico ISO VG 46',
    'Volume de óleo': '1.200 L',
    'Houve contagem de partículas?': 'Sim',
    'Contagem inicial NAS': '10',
    'Contagem final NAS': '6',
    'Contagem inicial ISO': '22/20/17',
    'Contagem final ISO': '17/15/12',
    'Houve desidratação?': 'Sim',
    'Houve análise de umidade?': 'Sim',
    'Umidade inicial (ppm)': '520',
    'Umidade final (ppm)': '90',
    'Etapas realizadas no dia': ['Montagem do circuito', 'Flushing primário', 'Desidratação', 'Amostragem final'],
    Observações: `${exampleNote}\nAmostras identificadas como AM-EX-01 (inicial) e AM-EX-02 (final). Resultados ilustrativos para demonstrar o preenchimento do relatório.`
  };
  const rlqData = {
    ...serviceData,
    'Material da tubulação': 'Aço carbono',
    'Tipo de inspeção': 'Visual e corpo de prova',
    'Método de limpeza': ['Circulação química', 'Enxágue'],
    'Etapas realizadas no dia': ['Desengraxe', 'Fase ácida', 'Fase neutralizante', 'Fase passivante'],
    Observações: `${exampleNote}\nInspeção inicial e final registradas para o circuito de demonstração. Etapas e produtos apresentados como dados ilustrativos.`
  };
  const rtpData = {
    ...serviceData,
    'Equipamento testado': 'Tubulação',
    'Fluido de teste': 'Água',
    'Pressão de trabalho': '10 bar',
    'Pressão de teste': '15 bar',
    Observações: `${exampleNote}\nPatamar ilustrativo de 15 bar mantido por 30 minutos, sem variação registrada no exemplo. Valores fictícios para avaliação do formato.`
  };
  return [
    {
      ...common,
      reportType: 'RDO',
      arrivalTime: '07:30',
      departureTime: '17:30',
      lunchBreak: '12:00 - 13:00',
      daytimeCount: 3,
      daytimeOvertimeMinutes: 60,
      overtimeReason: 'Conclusão dos registros e organização da área de demonstração.',
      dailyDescription: `${exampleNote}\n07:30 - Recepção da equipe e alinhamento das atividades de demonstração.\n08:00 - Preparação do circuito e execução do flushing ilustrativo.\n16:00 - Registro dos resultados, inspeção final e organização da área.`,
      specialConditions: {
        ...common.specialConditions,
        dds: { diurno: { enabled: true, inicio: '07:30', termino: '07:45', temas: ['Organização da área de trabalho', 'Comunicação da equipe'] } }
      },
      services: [{ serviceType: 'flushing', finalized: true, extraData: { ...rcpuData, 'Serviço finalizado?': 'Sim', tubes } }]
    },
    {
      ...common,
      reportType: 'RCPU',
      specialConditions: {
        ...common.specialConditions,
        serviceType: 'flushing', serviceData: rcpuData, totalMinutes: 480,
        resolvedUnits: ['UF-EX-01'], resolvedThermoUnit: 'UTV-EX-01',
        resolvedCounter: { code: 'CP-EX-01', serialNumber: 'SERIAL-EX-001' }
      }
    },
    {
      ...common,
      reportType: 'RLQ',
      specialConditions: { ...common.specialConditions, serviceType: 'limpeza', serviceData: rlqData, resolvedUnits: ['ULQ-EX-01'] }
    },
    {
      ...common,
      reportType: 'RTP',
      specialConditions: {
        ...common.specialConditions,
        serviceType: 'pressao', serviceData: rtpData, resolvedUnits: ['UTH-EX-01'],
        resolvedManometers: [
          { code: 'MAN-EX-01', scale: '0 - 25 bar', certCode: 'CAL-EX-001', calibratedAt: '2026-09-01', expiresAt: '2027-09-01' },
          { code: 'MAN-EX-02', scale: '0 - 25 bar', certCode: 'CAL-EX-002', calibratedAt: '2026-09-01', expiresAt: '2027-09-01' }
        ]
      }
    }
  ];
}
