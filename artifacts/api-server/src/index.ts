import {startComputationRecovery} from './lib/computation-recovery';
import { startAtsOutboxWorker } from './lib/ats-outbox';
import { startCodePracticeWorker } from './lib/code-practice';
import app from "./app";
import { logger } from "./lib/logger";
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { pool } from '@workspace/db';
import { startMicrotaskScheduler } from './lib/microtask-scheduler';
import { startResearchRetentionScheduler } from './routes/signal-research';
import { startSelectionWatchScheduler } from './lib/selection-watch';
import { startPdfImportRetention } from './lib/pdf-import-retention';
import { startInvitationExpiry } from './lib/invitation-analytics';

const rawPort = process.env["PORT"] || '4312';

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.get('/api/openapi.yaml', (_req, res) => res.type('application/yaml').sendFile(path.resolve('lib/api-spec/openapi.yaml')));
const publicDir = path.resolve('artifacts/fsp-signal/dist/public');
if (process.env.NODE_ENV === 'production' && fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { maxAge: '1h' }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  logger.info({ port }, "Server listening");
});
const stopMicrotaskScheduler = startMicrotaskScheduler();
const stopResearchRetentionScheduler = startResearchRetentionScheduler();
const stopSelectionWatchScheduler = startSelectionWatchScheduler();
const stopPdfImportRetention = startPdfImportRetention();
const stopInvitationExpiry = startInvitationExpiry();
const stopCodePracticeWorker = startCodePracticeWorker();
const stopAtsOutboxWorker = startAtsOutboxWorker();
const stopComputationRecovery = startComputationRecovery();
server.on('error', err => { logger.error({ err }, 'Server start failed'); process.exit(1); });
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMicrotaskScheduler();
  stopResearchRetentionScheduler();
  stopSelectionWatchScheduler();
  stopPdfImportRetention();
  stopInvitationExpiry();
  stopCodePracticeWorker();
  stopAtsOutboxWorker();
  stopComputationRecovery();
  server.close(() => { void pool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
