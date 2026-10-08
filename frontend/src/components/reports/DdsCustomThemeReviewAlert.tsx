import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { createDdsTheme, type DdsTheme } from '../../api/ddsThemes';
import { useToast } from '../ui/ToastContext';
import { Button } from '../ui/ds/Button';
import './DdsCustomThemeReviewAlert.css';

interface DdsThemeSnapshot {
  id: string;
  name: string;
  custom?: boolean;
}

interface DdsCustomThemeReviewAlertProps {
  dayThemes: DdsThemeSnapshot[];
  nightThemes: DdsThemeSnapshot[];
  officialThemes: DdsTheme[];
  canRegister: boolean;
  readOnly: boolean;
  onLinkTheme: (theme: { id: string; name: string }) => void;
}

export function DdsCustomThemeReviewAlert({
  dayThemes,
  nightThemes,
  officialThemes,
  canRegister,
  readOnly,
  onLinkTheme
}: DdsCustomThemeReviewAlertProps) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [registeringTheme, setRegisteringTheme] = useState<string | null>(null);
  const customThemes = useMemo(() => {
    const names = new Map<string, string>();
    [...dayThemes, ...nightThemes].forEach(theme => {
      if (theme.custom && theme.name.trim()) names.set(theme.name.trim().toLowerCase(), theme.name.trim());
    });
    return Array.from(names.values());
  }, [dayThemes, nightThemes]);

  async function registerCustomTheme(name: string) {
    setRegisteringTheme(name);
    try {
      const created = await createDdsTheme(name);
      queryClient.invalidateQueries({ queryKey: ['dds-themes'] });
      onLinkTheme(created);
      showToast('Tema cadastrado na lista de DDS. Salve o relatório para concluir.', 'success');
    } catch {
      const existing = officialThemes.find(item => item.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        onLinkTheme(existing);
        showToast('Tema já existia na lista; vinculado ao relatório. Salve para concluir.', 'success');
      } else {
        showToast('Não foi possível cadastrar o tema.', 'error');
      }
    } finally {
      setRegisteringTheme(null);
    }
  }

  if (!customThemes.length) return null;

  return (
    <div className="fv-ds dds-custom-theme-review-alert" role="alert">
      <strong>Temas de DDS fora da lista oficial.</strong>{' '}
      O colaborador registrou tema(s) que não estão na lista: valide cadastrando na lista oficial ou ajuste nos temas do DDS.
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {customThemes.map(name => (
          <li key={name} style={{ marginBottom: 4 }}>
            {name}
            {canRegister && !readOnly ? (
              <Button
                variant="primary"
                size="sm"
                type="button"
                style={{ marginLeft: 8 }}
                disabled={registeringTheme !== null}
                onClick={() => registerCustomTheme(name)}
              >
                {registeringTheme === name ? 'Cadastrando...' : 'Cadastrar na lista'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
