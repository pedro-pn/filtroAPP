import { randomUUID } from 'node:crypto';
import prisma from '../prisma.js';
import { clientEmailsEnabled, sendMail } from '../mailer.js';

const LEASE_MS = 15 * 60_000;
let processor;
let running = false;

export function configureReportEmailProcessor(value) { processor = value; }

export async function enqueueReportEmail(client, id, kind, payload) {
  return client.reportEmailJob.upsert({ where: { id }, create: { id, kind, payload }, update: {} });
}

export function reportEmailRetryAt(attempts, now) {
  return new Date(now.getTime() + Math.min(3_600_000, 10_000 * 2 ** Math.min(9, attempts - 1)));
}

export async function processReportEmailQueue({
  client = prisma, processJob = processor, mailer = sendMail,
  enabled = clientEmailsEnabled, now = () => new Date(), maxJobs = 20
} = {}) {
  if (!enabled()) return 0; // Keep pending rows intact in staging and during an email pause.
  if (!processJob) throw new Error('Report email processor is not configured.');
  let processed = 0;
  while (processed < maxJobs) {
    const started = now();
    const lockToken = randomUUID();
    const rows = await client.$queryRawUnsafe(`
      UPDATE "ReportEmailJob" SET status = 'RUNNING', "lockToken" = $1,
        "lockedUntil" = $2, attempts = attempts + 1, "updatedAt" = $3
      WHERE id = (SELECT id FROM "ReportEmailJob"
        WHERE (status = 'PENDING' AND "nextAttemptAt" <= $3)
           OR (status = 'RUNNING' AND "lockedUntil" <= $3)
        ORDER BY "nextAttemptAt", "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`, lockToken, new Date(started.getTime() + LEASE_MS).toISOString(), started.toISOString());
    const job = rows[0];
    if (!job) break;
    const owned = { id: job.id, status: 'RUNNING', lockToken };
    const renew = async () => {
      const lease = await client.reportEmailJob.updateMany({
        where: owned, data: { lockedUntil: new Date(now().getTime() + LEASE_MS) }
      });
      if (lease.count !== 1) throw new Error('Report email lease lost.');
    };
    const heartbeat = setInterval(() => void renew().catch(() => {}), LEASE_MS / 3);
    heartbeat.unref?.();
    try {
      await processJob(job, async (key, message) => {
        if (job.deliveredKeys.includes(key)) return;
        await renew();
        const result = await mailer(message);
        if (result?.skipped) throw new Error('Envio de e-mail desativado; entrega permanece pendente.');
        if (result?.rejected?.length) throw new Error('SMTP recusou o destinatário; entrega permanece pendente.');
        if (!result?.accepted?.some(email => String(email).toLowerCase() === String(message.to).toLowerCase())) {
          throw new Error('SMTP não confirmou a aceitação do destinatário.');
        }
        const saved = await client.reportEmailJob.updateMany({
          where: owned, data: { deliveredKeys: { push: key } }
        });
        if (saved.count !== 1) throw new Error('Report email receipt could not be saved.');
        job.deliveredKeys.push(key);
      });
      await client.reportEmailJob.updateMany({
        where: owned, data: { status: 'COMPLETED', completedAt: now(), lockToken: null, lockedUntil: null, lastError: null }
      });
    } catch (error) {
      await client.reportEmailJob.updateMany({
        where: owned, data: {
          status: 'PENDING', lockToken: null, lockedUntil: null,
          nextAttemptAt: reportEmailRetryAt(job.attempts, now()),
          lastError: String(error?.message || error).slice(0, 2000)
        }
      });
      console.error('E-mail de relatório pendente; nova tentativa agendada.', { jobId: job.id, attempts: job.attempts, error: error?.message });
    } finally { clearInterval(heartbeat); }
    processed += 1;
  }
  return processed;
}

export function startReportEmailJob({ intervalMs = 10_000, keepAlive = false } = {}) {
  const run = async () => {
    if (running) return;
    running = true;
    try { await processReportEmailQueue(); }
    catch (error) { console.error('Falha na fila de e-mails de relatórios.', error?.message); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  if (!keepAlive) timer.unref?.();
  void run();
  return timer;
}
