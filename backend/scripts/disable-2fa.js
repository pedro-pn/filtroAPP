// Acesso de emergência ao 2FA (spec 039). Libera UM login sem código para a conta,
// válido pelos próximos minutos (padrão 60), e registra o evento na trilha de segurança.
// Uso no servidor:
//   docker compose --env-file backend/.env.production -f docker-compose.prod.yml \
//     exec backend node scripts/disable-2fa.js --username admin [--minutes 60]
// Para desligar o 2FA de todos de uma vez (ex.: SMTP fora do ar), use
// TWO_FACTOR_ENFORCEMENT=off no .env e recrie backend/worker (docs/RUNBOOK_INCIDENTES.md).
import { BREAK_GLASS_DEFAULT_MINUTES } from '../src/lib/accounts/two-factor.js';
import prisma from '../src/lib/prisma.js';

export function parseBreakGlassArgs(argv) {
  const value = name => {
    const inline = argv.find(arg => arg.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const username = String(value('username') || '').trim();
  const minutes = Number(value('minutes') ?? BREAK_GLASS_DEFAULT_MINUTES);
  if (!username) throw new TypeError('Informe --username <usuário>.');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new TypeError('--minutes deve ser um inteiro entre 1 e 1440.');
  }
  return { username, minutes };
}

export async function grantTwoFactorBypass(prismaClient, { username, minutes, now = new Date() }) {
  const user = await prismaClient.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true, username: true, isActive: true }
  });
  if (!user) throw new Error(`Conta ${username} não encontrada.`);
  if (!user.isActive) throw new Error(`Conta ${user.username} está desativada.`);
  const until = new Date(now.getTime() + minutes * 60_000);
  await prismaClient.user.update({ where: { id: user.id }, data: { twoFactorBypassUntil: until } });
  await prismaClient.authSecurityEvent.create({
    data: { userId: user.id, type: 'TWO_FACTOR_BREAK_GLASS', metadata: { minutes, source: 'scripts/disable-2fa.js' } }
  });
  return { username: user.username, until };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseBreakGlassArgs(process.argv.slice(2));
    const result = await grantTwoFactorBypass(prisma, args);
    console.log(`Acesso de emergência liberado para ${result.username}: um login sem código até ${result.until.toISOString()}.`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
