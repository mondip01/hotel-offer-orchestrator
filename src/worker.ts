import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { config } from './config';
import { logger } from './logger';

async function connectWithRetry(): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect({ address: config.temporalAddress });
    } catch (err) {
      logger.warn('Temporal not reachable yet, retrying', { attempt, address: config.temporalAddress, err: String(err) });
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  const connection = await connectWithRetry();
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });
  logger.info('Temporal worker started', { taskQueue: config.taskQueue, address: config.temporalAddress });
  await worker.run();
}

main().catch((err) => {
  logger.error('Worker crashed', { err: String(err) });
  process.exit(1);
});
