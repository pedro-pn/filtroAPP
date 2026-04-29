interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <header className="topbar-react">
      <div>
        <div className="topbar-title">{title}</div>
        {subtitle ? <div className="topbar-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="topbar-actions-react">{actions}</div> : null}
    </header>
  );
}
