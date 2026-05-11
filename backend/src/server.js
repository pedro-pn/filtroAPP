import http from 'node:http';

import app from './app.js';
import env from './config/env.js';
import { startSurveyReminderJob } from './lib/survey-reminders.js';

const server = http.createServer(app);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Porta ${env.port} já está em uso. Pare o outro processo Node ou troque o PORT no arquivo backend/.env.`
    );
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(env.port, () => {
  console.log(`API running on http://localhost:${env.port}`);
  startSurveyReminderJob();
});
