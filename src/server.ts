import { randomUUID } from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { Client, Connection, WorkflowFailedError } from '@temporalio/client';
import { config } from './config';
import { logger } from './logger';
import { mockSupplierRouter } from './mockSuppliers';
import { pingRedis, queryHotels } from './redisStore';
import { hotelOfferWorkflow } from './workflows';

async function connectTemporal(): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    try {
      const connection = await Connection.connect({ address: config.temporalAddress });
      return new Client({ connection, namespace: config.temporalNamespace });
    } catch (err) {
      logger.warn('Temporal not reachable yet, retrying', { attempt, err: String(err) });
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Parses an optional non-negative number query param. Returns undefined if absent, NaN if invalid. */
function parsePrice(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

type Probe = { status: 'up' | 'down'; responseMs?: number; error?: string };

async function probeSupplier(path: string): Promise<Probe> {
  const started = Date.now();
  try {
    const res = await fetch(`${config.supplierBaseUrl}${path}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'up', responseMs: Date.now() - started };
  } catch (err) {
    return { status: 'down', responseMs: Date.now() - started, error: String((err as Error).message ?? err) };
  }
}

const check = (p: Promise<unknown>): Promise<Probe> =>
  p.then((): Probe => ({ status: 'up' })).catch((e): Probe => ({ status: 'down', error: String(e?.message ?? e) }));

async function main() {
  const temporal = await connectTemporal();
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () =>
      logger.info('http_request', { method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - started }),
    );
    next();
  });

  // --- mock supplier endpoints (+ outage toggle) ---
  app.use(mockSupplierRouter());

  // --- main endpoint ---
  app.get('/api/hotels', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : '';
      if (!city) {
        res.status(400).json({ error: 'Query param "city" is required' });
        return;
      }
      const minPrice = parsePrice(req.query.minPrice);
      const maxPrice = parsePrice(req.query.maxPrice);
      if (Number.isNaN(minPrice) || Number.isNaN(maxPrice)) {
        res.status(400).json({ error: '"minPrice" and "maxPrice" must be non-negative numbers' });
        return;
      }
      if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
        res.status(400).json({ error: '"minPrice" cannot be greater than "maxPrice"' });
        return;
      }

      // Temporal orchestrates: parallel supplier calls -> dedupe -> save to Redis
      const hotels = await temporal.workflow.execute(hotelOfferWorkflow, {
        taskQueue: config.taskQueue,
        workflowId: `hotel-offers-${city}-${randomUUID()}`,
        args: [{ city }],
        workflowExecutionTimeout: '30 seconds',
      });

      // With a price range, the filtering is performed inside Redis (ZRANGEBYSCORE)
      const filtered = minPrice !== undefined || maxPrice !== undefined;
      res.json(filtered ? await queryHotels(city, minPrice, maxPrice) : hotels);
    } catch (err) {
      next(err);
    }
  });

  // --- health (bonus): reports each supplier + redis + temporal ---
  app.get('/health', async (_req, res) => {
    const [supplierA, supplierB, redis, temporalHealth] = await Promise.all([
      probeSupplier('/supplierA/hotels?city=__health__'),
      probeSupplier('/supplierB/hotels?city=__health__'),
      check(pingRedis()),
      check(temporal.connection.workflowService.getSystemInfo({})),
    ]);
    const suppliersUp = [supplierA, supplierB].filter((s) => s.status === 'up').length;
    const critical = redis.status === 'up' && temporalHealth.status === 'up' && suppliersUp > 0;
    const status = !critical ? 'down' : suppliersUp === 2 ? 'ok' : 'degraded';
    res.status(status === 'down' ? 503 : 200).json({
      status,
      suppliers: { 'Supplier A': supplierA, 'Supplier B': supplierB },
      redis,
      temporal: temporalHealth,
    });
  });

  // --- error handling ---
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof WorkflowFailedError) {
      logger.error('Workflow failed', { cause: err.cause?.message });
      res.status(502).json({ error: 'Could not fetch offers from suppliers', detail: err.cause?.message });
      return;
    }
    logger.error('Unhandled error', { err: String((err as Error)?.message ?? err) });
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(config.port, () => logger.info('API listening', { port: config.port }));
}

main().catch((err) => {
  logger.error('API crashed on startup', { err: String(err) });
  process.exit(1);
});
