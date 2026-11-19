// Caixa de e-mail de teste (Mailpit). Só a API HTTP do Mailpit é usada aqui;
// o app envia e-mail pelo SMTP normal, sem nenhum caminho "de teste".
const mailpitUrl = (process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:8025').replace(/\/$/, '');

type MailpitMessage = {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
};

export async function clearMailbox() {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Mailpit não respondeu ao limpar a caixa (${response.status}).`);
}

async function messagesTo(address: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=50`);
  if (!response.ok) throw new Error(`Mailpit não respondeu (${response.status}).`);
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  return (body.messages || []).filter(message =>
    message.To.some(to => to.Address.toLowerCase() === address.toLowerCase())
  );
}

// Espera (até 15 s) o e-mail com o código de acesso enviado depois de `since`.
export async function waitForLoginCode(address: string, since: Date): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const fresh = (await messagesTo(address))
      .filter(message => new Date(message.Created).getTime() >= since.getTime() - 1_000)
      .map(message => /Código de acesso:\s*(\d{6})/.exec(message.Subject)?.[1])
      .filter((code): code is string => Boolean(code));
    if (fresh.length) return fresh[0];
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Nenhum código de acesso chegou para ${address} em 15 s.`);
}
