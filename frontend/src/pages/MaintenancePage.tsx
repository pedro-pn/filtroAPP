const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const loginLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_LOGIN.png`;

export function MaintenancePage() {
  return (
    <main className="auth-page maintenance-page">
      <section className="auth-card maintenance-card" aria-labelledby="maintenance-title">
        <div className="auth-logo-wrap">
          <img className="auth-logo" src={loginLogoUrl} alt="Filtrovali" />
          <p className="auth-subtitle">Sistema de relatórios de serviços</p>
        </div>

        <div className="maintenance-content">
          <div className="maintenance-status" aria-hidden="true">
            <span />
          </div>
          <h1 id="maintenance-title">Servidor em manutenção</h1>
          <p>
            Estamos realizando uma atualização programada no servidor. O acesso ao sistema será
            restabelecido assim que a manutenção for concluída.
          </p>
          <p className="maintenance-note">Agradecemos a compreensão.</p>
        </div>
      </section>
    </main>
  );
}
