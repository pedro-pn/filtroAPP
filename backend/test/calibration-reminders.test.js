import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
import {
  CalibrationReminderMilestone,
  notifyCalibrationUpdated,
  processCalibrationReminders,
  shouldNotifyCalibrationUpdated
} from '../src/lib/calibration-reminders.js';

const NOW = new Date('2026-06-05T12:00:00.000Z');

function managerUser() {
  return {
    id: 'manager-1',
    username: 'gestor',
    email: 'gestor@example.com',
    role: 'MANAGER',
    isActive: true,
    notifyReportsByEmail: true,
    notifySignaturesByEmail: true,
    notifySignatureRemindersByEmail: true,
    notifySurveyRemindersByEmail: true,
    notifyCalibrationRemindersByEmail: true
  };
}

function coordinatorUser() {
  return {
    ...managerUser(),
    id: 'coordinator-1',
    username: 'coord',
    email: 'coord@example.com',
    role: 'COORDINATOR'
  };
}

function makeClient({ manometers = [], particleCounters = [], logs = [], users = [managerUser()] } = {}) {
  const createdLogs = [];
  return {
    createdLogs,
    manometer: {
      async findMany() {
        return manometers;
      }
    },
    particleCounter: {
      async findMany() {
        return particleCounters;
      }
    },
    user: {
      async findMany() {
        return users;
      }
    },
    notificationPreferenceToken: {
      async findFirst() {
        return { tokenHash: 'pref-token' };
      },
      async create() {
        return { tokenHash: 'pref-token' };
      }
    },
    calibrationNotificationLog: {
      async findMany(args) {
        if (Array.isArray(args.where?.OR)) {
          return logs.filter(log => args.where.OR.some(where =>
            log.equipmentType === where.equipmentType &&
            log.equipmentId === where.equipmentId &&
            log.milestone === where.milestone &&
            new Date(log.targetDate).getTime() === new Date(where.targetDate).getTime()
          ));
        }
        if (args.where?.milestone === CalibrationReminderMilestone.EXPIRED_REPEAT) {
          const equipmentIds = args.where.equipmentId?.in || [];
          const sentAfter = args.where.sentAt?.gte ? new Date(args.where.sentAt.gte).getTime() : 0;
          return logs.filter(log =>
            log.milestone === CalibrationReminderMilestone.EXPIRED_REPEAT &&
            equipmentIds.includes(log.equipmentId) &&
            new Date(log.sentAt).getTime() >= sentAfter
          );
        }
        return [];
      },
      async createMany(args) {
        createdLogs.push(...args.data);
        return { count: args.data.length };
      }
    }
  };
}

async function runScenario(equipment) {
  const client = makeClient(equipment);
  const messages = [];
  const result = await processCalibrationReminders({
    client,
    now: NOW,
    missingMailerConfig: [],
    async mailer(message) {
      messages.push(message);
    }
  });
  return { client, messages, result };
}

test('skips calibration reminder job when operational emails are disabled', async t => {
  const original = env.sendClientEmails;
  t.after(() => {
    env.sendClientEmails = original;
  });
  env.sendClientEmails = false;

  const client = {
    manometer: {
      async findMany() {
        throw new Error('equipment must not be queried while mail is disabled');
      }
    },
    particleCounter: {
      async findMany() {
        throw new Error('equipment must not be queried while mail is disabled');
      }
    }
  };

  const result = await processCalibrationReminders({
    client,
    missingMailerConfig: []
  });

  assert.deepEqual(result, {
    checked: 0,
    sent: 0,
    skipped: true,
    reason: 'outbound_emails_disabled'
  });
});

test('sends one manager email 30 days before particle counter calibration expires', async () => {
  const { messages, result } = await runScenario({
    particleCounters: [{
      id: 'counter-1',
      code: 'CP-001',
      serialNumber: 'SN-001',
      category: 'CONTADOR DE PARTICULAS',
      expiresAt: new Date('2026-07-05T00:00:00.000Z')
    }]
  });

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'gestor@example.com');
  assert.match(messages[0].subject, /vence em 30 dias/);
  assert.match(messages[0].text, /CP-001/);
  assert.match(messages[0].text, /SN-001/);
  assert.match(messages[0].text, /05\/07\/2026/);
  assert.match(messages[0].text, /\/notificacoes\/pref-token/);
});

test('groups manometers in one manager email 15 days before calibration expires', async () => {
  const { client, messages, result } = await runScenario({
    manometers: [
      { id: 'manometer-1', code: 'MN-001', expiresAt: new Date('2026-06-20T00:00:00.000Z') },
      { id: 'manometer-2', code: 'MN-002', expiresAt: new Date('2026-06-20T00:00:00.000Z') }
    ]
  });

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'gestor@example.com');
  assert.match(messages[0].subject, /vence em 15 dias/);
  assert.match(messages[0].text, /MN-001/);
  assert.match(messages[0].text, /MN-002/);
  assert.equal(client.createdLogs.length, 2);
});

test('sends one manager email 7 days before particle counter calibration expires', async () => {
  const { messages, result } = await runScenario({
    particleCounters: [{
      id: 'counter-7',
      code: 'CP-007',
      serialNumber: 'SN-007',
      category: 'CONTADOR DE PARTICULAS',
      expiresAt: new Date('2026-06-12T00:00:00.000Z')
    }]
  });

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'gestor@example.com');
  assert.match(messages[0].subject, /vence em 7 dias/);
  assert.match(messages[0].text, /CP-007/);
  assert.match(messages[0].text, /12\/06\/2026/);
});

test('sends one manager email on calibration expiration day', async () => {
  const { messages, result } = await runScenario({
    manometers: [{
      id: 'manometer-today',
      code: 'MN-HOJE',
      expiresAt: new Date('2026-06-05T00:00:00.000Z')
    }]
  });

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'gestor@example.com');
  assert.match(messages[0].subject, /expira hoje/);
  assert.match(messages[0].text, /MN-HOJE/);
  assert.match(messages[0].text, /05\/06\/2026/);
});

test('sends one manager repeat email with all expired equipment in the category', async () => {
  const { client, messages, result } = await runScenario({
    particleCounters: [
      {
        id: 'counter-expired-1',
        code: 'CP-V001',
        serialNumber: 'SN-V001',
        category: 'CONTADOR DE PARTICULAS',
        expiresAt: new Date('2026-06-01T00:00:00.000Z')
      },
      {
        id: 'counter-expired-2',
        code: 'CP-V002',
        serialNumber: 'SN-V002',
        category: 'CONTADOR DE PARTICULAS',
        expiresAt: new Date('2026-05-20T00:00:00.000Z')
      }
    ]
  });

  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'gestor@example.com');
  assert.match(messages[0].subject, /expirada/);
  assert.match(messages[0].text, /CP-V001/);
  assert.match(messages[0].text, /CP-V002/);
  assert.equal(client.createdLogs.length, 1);
  assert.equal(client.createdLogs[0].milestone, CalibrationReminderMilestone.EXPIRED_REPEAT);
});

test('keeps expired calibration repeat cadence after stack restart', async () => {
  const { client, messages, result } = await runScenario({
    logs: [{
      equipmentType: 'CATEGORY',
      equipmentId: 'CATEGORY:CONTADOR DE PARTICULAS',
      category: 'CONTADOR DE PARTICULAS',
      milestone: CalibrationReminderMilestone.EXPIRED_REPEAT,
      targetDate: new Date('2026-06-02T00:00:00.000Z'),
      sentAt: new Date('2026-06-02T00:00:00.000Z')
    }],
    particleCounters: [{
      id: 'counter-expired-restart',
      code: 'CP-RST',
      serialNumber: 'SN-RST',
      category: 'CONTADOR DE PARTICULAS',
      expiresAt: new Date('2026-06-01T00:00:00.000Z')
    }]
  });

  assert.deepEqual(result, { checked: 1, sent: 0 });
  assert.equal(messages.length, 0);
  assert.equal(client.createdLogs.length, 0);
});

test('skips calibration email when the manager opted out', async () => {
  const client = makeClient({
    users: [{ ...managerUser(), notifyCalibrationRemindersByEmail: false }],
    particleCounters: [{
      id: 'counter-opt-out',
      code: 'CP-OPT',
      serialNumber: 'SN-OPT',
      category: 'CONTADOR DE PARTICULAS',
      expiresAt: new Date('2026-07-05T00:00:00.000Z')
    }]
  });
  const messages = [];

  const result = await processCalibrationReminders({
    client,
    now: NOW,
    missingMailerConfig: [],
    async mailer(message) {
      messages.push(message);
    }
  });

  assert.equal(result.sent, 0);
  assert.equal(messages.length, 0);
  assert.equal(client.createdLogs.length, 0);
});

test('calibration update notification is due only when expiration changed to a future date', () => {
  assert.equal(shouldNotifyCalibrationUpdated({
    previousExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    nextExpiresAt: new Date('2026-07-01T00:00:00.000Z'),
    now: NOW
  }), true);
  assert.equal(shouldNotifyCalibrationUpdated({
    previousExpiresAt: new Date('2026-07-01T00:00:00.000Z'),
    nextExpiresAt: new Date('2026-07-01T12:00:00.000Z'),
    now: NOW
  }), false);
  assert.equal(shouldNotifyCalibrationUpdated({
    previousExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    nextExpiresAt: new Date('2026-06-04T00:00:00.000Z'),
    now: NOW
  }), false);
});

test('sends calibration updated email to manager and coordinator', async () => {
  const client = makeClient({
    users: [managerUser(), coordinatorUser()]
  });
  const messages = [];

  const sent = await notifyCalibrationUpdated({
    client,
    now: NOW,
    missingMailerConfig: [],
    equipmentType: 'PARTICLE_COUNTER',
    previousExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    equipment: {
      id: 'counter-calibrated',
      code: 'CP-CAL',
      serialNumber: 'SN-CAL',
      category: 'CONTADOR DE PARTICULAS',
      calibratedAt: new Date('2026-06-05T00:00:00.000Z'),
      expiresAt: new Date('2026-12-05T00:00:00.000Z')
    },
    async mailer(message) {
      messages.push(message);
    }
  });

  assert.equal(sent, true);
  assert.deepEqual(messages.map(message => message.to), ['gestor@example.com', 'coord@example.com']);
  assert.match(messages[0].subject, /Equipamento calibrado/);
  assert.match(messages[0].text, /CP-CAL/);
  assert.match(messages[0].text, /SN-CAL/);
  assert.match(messages[0].text, /Nova validade: 05\/12\/2026/);
});
