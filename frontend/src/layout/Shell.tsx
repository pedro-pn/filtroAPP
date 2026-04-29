interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  return <div className="app-shell">{children}</div>;
}
