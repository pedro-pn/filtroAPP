import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

export const API_WRITE_SIMULATION_LAUNCHED_AT = '2026-10-29T00:00:00-03:00';
export const API_WRITE_SIMULATION_EXPIRES_AT = '2026-11-08T00:00:00-03:00';
export function isApiWriteSimulationNoveltyActive(now = Date.now()) {
  return now >= Date.parse(API_WRITE_SIMULATION_LAUNCHED_AT) && now < Date.parse(API_WRITE_SIMULATION_EXPIRES_AT);
}

export function startApiWriteSimulationNovelty(user: { id: string } | null | undefined) {
  if (!user || !isApiWriteSimulationNoveltyActive() || document.body.classList.contains('driver-active')) return;
  try {
    const prefix = `filtrovali:api-write-simulation:v1:${user.id}:`;
    const steps: DriveStep[] = [];
    const seenKeys: string[] = [];
    if (!localStorage.getItem(prefix + 'notice')) {
      steps.push({ popover: { title: 'Simulação de escritas da API',
        description: 'O Playground agora simula as escritas por padrão. Tokens em SIMULATE sempre validam sem salvar. O modo aparece na lista e pode ser alterado nos detalhes do token.' } });
      seenKeys.push(prefix + 'notice');
    }
    for (const [selector, title, description] of [
      ['[data-api-write-mode]', 'Modo no Playground', 'Mantenha Simular para validar. Real salva dados e pede confirmação; tokens SIMULATE continuam simulando.'],
      ['[data-api-credential-write-mode]', 'Modo da credencial', 'SIMULATE protege todas as escritas desse token, inclusive clientes sem o cabeçalho de simulação. A alteração exige justificativa e fica no histórico.']
    ]) {
      const element = document.querySelector(selector);
      if (element && !localStorage.getItem(prefix + selector)) {
        steps.push({ element, popover: { title, description } }); seenKeys.push(prefix + selector);
      }
    }
    if (!steps.length) return;
    seenKeys.forEach(key => localStorage.setItem(key, '1'));
    driver({ steps, showProgress: true, nextBtnText: 'Próximo', prevBtnText: 'Voltar', doneBtnText: 'Concluir',
      onDestroyed: () => { window.setTimeout(() => startApiWriteSimulationNovelty(user), 200); }
    }).drive();
  } catch { /* Storage indisponível não bloqueia o painel. */ }
}
