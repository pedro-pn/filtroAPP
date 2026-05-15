import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { TopBar } from '../../layout/TopBar';
import type { AuthUser } from '../../types/auth';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const logoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

interface ModuleCard {
  id: string;
  label: string;
  description: string;
  path: string;
}

const ALL_MODULES: ModuleCard[] = [
  {
    id: 'RDO',
    label: 'Relatórios',
    description: 'Controle de projetos e relatórios diários de obra',
    path: '/gestor',
  },
  {
    id: 'ROMANEIO',
    label: 'Romaneio',
    description: 'Controle de movimentação de equipamentos',
    path: '/romaneio',
  },
  {
    id: 'EPI',
    label: 'EPI',
    description: 'Fichas de liberação de equipamentos de proteção',
    path: '/epi',
  },
];

function rdoPathForRole(role: string | undefined) {
  if (role === 'MANAGER') return '/gestor';
  if (role === 'COORDINATOR') return '/coordenador';
  return '/home';
}

function getAccessibleModules(user: AuthUser | null): ModuleCard[] {
  if (!user) return [];
  if (user.accountType === 'CLIENT') return [];

  const assignedModuleIds = new Set(user.moduleRoles.map(mr => mr.module));

  return ALL_MODULES.map(m => {
    const path = m.id === 'RDO' ? rdoPathForRole(user.role) : m.path;
    const hasRole = assignedModuleIds.has(m.id as 'RDO' | 'ROMANEIO' | 'EPI');
    const isUnimplemented = m.id === 'ROMANEIO' || m.id === 'EPI';
    if (hasRole || isUnimplemented) return { ...m, path };
    return null;
  }).filter((m): m is ModuleCard => m !== null);
}

function ModuleButton({ mod, onClick }: { mod: ModuleCard; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      style={S.moduleBtn}
      onClick={onClick}
      onMouseEnter={() => ref.current && Object.assign(ref.current.style, S.moduleBtnHover)}
      onMouseLeave={() => ref.current && Object.assign(ref.current.style, S.moduleBtn)}
      onFocus={() => ref.current && Object.assign(ref.current.style, S.moduleBtnHover)}
      onBlur={() => ref.current && Object.assign(ref.current.style, S.moduleBtn)}
    >
      <span style={S.moduleBtnLabel}>{mod.label}</span>
      <span style={S.moduleBtnDesc}>{mod.description}</span>
    </button>
  );
}

export function HubPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accessibleModules = getAccessibleModules(user);

  const isAdmin = user?.accountType === 'ADMIN';
  const shouldRedirect = !isAdmin && accessibleModules.length === 1;

  useEffect(() => {
    if (!user) return;
    if (user.accountType === 'CLIENT') {
      navigate('/cliente', { replace: true });
      return;
    }
    if (shouldRedirect) {
      navigate(accessibleModules[0].path, { replace: true });
    }
  }, [user, shouldRedirect, accessibleModules, navigate]);

  if (!user) return null;
  if (user.accountType === 'CLIENT') return null;
  if (shouldRedirect) return null;

  const firstName = user.name.split(' ')[0];
  // Tenta colocar todos lado a lado; se forem mais de 3, usa 2 colunas
  const cols = accessibleModules.length <= 3 ? accessibleModules.length : 2;

  return (
    <div style={S.page}>
      <div style={S.shell}>

        <TopBar
          title="Hub"
          subtitle={user.name}
          showLogo
          actions={
            <>
              {isAdmin && (
                <button className="topbar-chip" type="button" onClick={() => navigate('/admin/accounts')}>
                  Contas
                </button>
              )}
              <button className="topbar-chip" type="button" onClick={() => navigate('/conta')}>
                Conta
              </button>
              <button className="topbar-chip" type="button" onClick={logout}>
                Sair
              </button>
            </>
          }
        />

        <div style={S.body}>

          <div style={S.logoBlock}>
            <img src={logoUrl} alt="Filtrovali" style={S.logo} />
            <p style={S.greeting}>Olá, {firstName}</p>
          </div>

          {accessibleModules.length > 0 ? (
            <div style={{ ...S.grid, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {accessibleModules.map(mod => (
                <ModuleButton key={mod.id} mod={mod} onClick={() => navigate(mod.path)} />
              ))}
            </div>
          ) : (
            <p style={S.empty}>Nenhum módulo disponível para esta conta.</p>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── Estilos ─────────────────────────────────────────────────────── */

const G  = '#30503a';
const GL = '#3d6449';
const BG = '#e9ebe9';

const S = {
  page: {
    width: '100%',
    minHeight: '100vh',
    background: BG,
    display: 'flex',
    justifyContent: 'center',
  } as React.CSSProperties,

  shell: {
    width: '100%',
    maxWidth: 520,
    minHeight: '100vh',
    background: BG,
    display: 'flex',
    flexDirection: 'column' as const,
    overflowX: 'hidden' as const,
  } as React.CSSProperties,

  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '28px 16px 48px',
    gap: 32,
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  logoBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,

  logo: {
    height: 210,
    width: 'auto',
    display: 'block',
    objectFit: 'contain' as const,
    mixBlendMode: 'multiply' as const,
  } as React.CSSProperties,

  greeting: {
    margin: 0,
    color: '#6b7280',
    fontSize: 15,
    fontWeight: 500,
  } as React.CSSProperties,

  grid: {
    width: '100%',
    display: 'grid',
    gap: 12,
  } as React.CSSProperties,

  moduleBtn: {
    aspectRatio: '1 / 1',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '16px',
    background: G,
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
    textAlign: 'center' as const,
    boxShadow: '0 2px 10px rgba(48,80,58,0.15)',
    transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
    transform: 'translateY(0)',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  moduleBtnHover: {
    aspectRatio: '1 / 1',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '16px',
    background: GL,
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
    textAlign: 'center' as const,
    boxShadow: '0 6px 18px rgba(48,80,58,0.25)',
    transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
    transform: 'translateY(-2px)',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  moduleBtnLabel: {
    fontSize: 16,
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.2,
  } as React.CSSProperties,

  moduleBtnDesc: {
    fontSize: 11,
    fontWeight: 400,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 1.4,
    textAlign: 'center' as const,
  } as React.CSSProperties,

  empty: {
    color: '#6b7280',
    fontSize: 14,
    margin: 0,
  } as React.CSSProperties,
} as const;
