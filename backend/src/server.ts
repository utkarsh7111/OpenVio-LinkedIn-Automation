import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createSchedulerAdapter } from './adapters/scheduler.js';
import { processDuePosts } from './jobs/processDuePosts.js';

const scheduler = createSchedulerAdapter({ processDuePosts, intervalSeconds: env.schedulerIntervalSeconds });
const server = app.listen(env.port, () => {
  console.log(`OpenVio backend listening on port ${env.port}`);
  scheduler.start();
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

let closing = false;
async function shutdown(signal: string, code = 0): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`Received ${signal}; shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  await scheduler.stopAndWait();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(code);
  });
  (server as any).closeIdleConnections?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Never leave the process in an undefined state after an unexpected failure.
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : null;
  console.error(
    JSON.stringify({
      event: 'unhandled_rejection',
      errorType: err ? err.name : 'non-error',
      message: err ? err.message : String(reason),
    }),
  );
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error: Error) => {
  console.error(JSON.stringify({ event: 'uncaught_exception', errorType: error.name, message: error.message, code: (error as any).code }));
  shutdown('uncaughtException', 1);
});
