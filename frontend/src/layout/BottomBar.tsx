interface BottomBarProps {
  children: React.ReactNode;
}

export function BottomBar({ children }: BottomBarProps) {
  return <footer className="bottom-bar-react">{children}</footer>;
}
