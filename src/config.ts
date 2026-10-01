const num = (v: string | undefined, d: number) => (v !== undefined && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'hotel-offers',
  supplierBaseUrl: process.env.SUPPLIER_BASE_URL ?? `http://localhost:${num(process.env.PORT, 3000)}`,
  supplierTimeoutMs: num(process.env.SUPPLIER_TIMEOUT_MS, 3000),
  cacheTtlSeconds: num(process.env.CACHE_TTL_SECONDS, 300),
};
