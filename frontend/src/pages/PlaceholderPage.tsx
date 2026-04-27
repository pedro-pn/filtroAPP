import { Shell } from '../layout/Shell';
import { TopBar } from '../layout/TopBar';

interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
  description: string;
}

export function PlaceholderPage({ title, subtitle, description }: PlaceholderPageProps) {
  return (
    <Shell>
      <TopBar title={title} subtitle={subtitle} />
      <main className="page-scroll">
        <section className="page-card">
          <div className="section-title">Em migração</div>
          <p className="placeholder-copy">{description}</p>
        </section>
      </main>
    </Shell>
  );
}
