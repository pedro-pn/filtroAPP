import { efetivoProjectBaseWhere } from './project-visibility-rules.js';
import { projectChannelWhere } from '../projects/distribution.js';

export function efetivoProjectWhere() {
  return {
    ...efetivoProjectBaseWhere(),
    ...projectChannelWhere('efetivo'),
  };
}
