import { Alert, Button, Card, Field, Input } from '../ui/ds';
import './PasswordSetupLinkCard.css';

interface PasswordSetupLinkCardProps {
  inputId: string;
  username: string;
  url: string;
  onCopy: () => void | Promise<void>;
}

export function PasswordSetupLinkCard({ inputId, username, url, onCopy }: PasswordSetupLinkCardProps) {
  return <div className="fv-ds password-setup-link">
    <Card title={<h3>Link para criar a senha</h3>}>
      <p className="password-setup-link__person">Usuário: <strong>{username}</strong></p>
      <Alert tone="info">O link é de uso único e expira em 7 dias. Compartilhe apenas com o usuário desta conta.</Alert>
      <div className="password-setup-link__controls">
        <Field id={inputId} label="Link para compartilhar" optionalText={null}>
          <Input value={url} readOnly onFocus={event => event.currentTarget.select()} />
        </Field>
        <Button variant="primary" type="button" onClick={() => void onCopy()}>Copiar link</Button>
      </div>
    </Card>
  </div>;
}
