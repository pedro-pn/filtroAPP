import {
  Activity,
  Archive,
  BadgeCheck,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  ChevronUp,
  CircleCheck,
  CircleSlash2,
  ClipboardList,
  Clock3,
  Cog,
  Ellipsis,
  FileText,
  HardHat,
  HelpCircle,
  FileSignature,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  TrendingUp,
  Truck,
  UserRound,
  UsersRound,
  Wallet,
  Wrench,
  X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { HubModuleId } from '../modules/registry';

export const MODULE_NAVIGATION_ICONS = {
  rdo: ClipboardList,
  'maintenance-production': Wrench,
  admin: UsersRound,
  equipamentos: Cog,
  estoque: Boxes,
  qualidade: BadgeCheck,
  acompanhamento: BarChart3,
  romaneio: Truck,
  epi: HardHat,
  privacy: ShieldCheck,
  efetivo: CalendarDays,
  assinaturas: FileSignature,
  none: CircleSlash2
} satisfies Record<HubModuleId, LucideIcon>;

export const NAVIGATION_CHROME_ICONS = {
  account: UserRound,
  close: X,
  collapse: ChevronUp,
  help: HelpCircle,
  home: LayoutDashboard,
  logout: LogOut,
  menu: Menu,
  more: Ellipsis,
  notifications: Bell,
  operations: Activity,
  search: Search,
  sidebarCollapse: PanelLeftClose,
  sidebarExpand: PanelLeftOpen,
  settings: Settings
} as const;

const SECTION_NAVIGATION_ICONS: Record<string, Record<string, LucideIcon>> = {
  rdo: {
    home: LayoutDashboard,
    reports: FileText,
    pending: Clock3,
    approved: CircleCheck,
    ongoing: Activity,
    archived: Archive,
    pendentes: Clock3,
    aprovados: CircleCheck,
    projetos: FolderKanban,
    arquivados: Archive,
    equipe: UsersRound,
    usuarios: UserRound,
    nps: BadgeCheck,
    estatisticas: BarChart3
  },
  acompanhamento: {
    dashboard: LayoutDashboard,
    projetos: FolderKanban,
    sede: Building2,
    custo: Wallet
  },
  efetivo: {
    'visao-geral': LayoutDashboard,
    calendario: CalendarDays,
    colaboradores: UsersRound,
    disponibilidade: Clock3,
    evolucao: TrendingUp,
    produtividade: BarChart3,
    administracao: Cog
  },
  assinaturas: {
    active: FileSignature,
    archived: Archive
  }
};

export function navigationSectionIcon(moduleId: string, sectionId: string): LucideIcon {
  return SECTION_NAVIGATION_ICONS[moduleId]?.[sectionId] ?? FileText;
}
