import Redis from 'ioredis';
import { config } from './config';
import { normalizeName } from './dedupe';
import type { Hotel } from './types';

/**
 * Redis layout (per city):
 *   hotels:<city>        ZSET   member = normalized hotel name, score = price   -> price range filtering
 *   hotels:<city>:data   HASH   field  = normalized hotel name, value = JSON of the Hotel
 *
 * Price filtering is done by Redis itself with ZRANGEBYSCORE, then the matching
 * hotels are hydrated from the hash with a single HMGET.
 */
let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  }
  return client;
}

const zsetKey = (city: string) => `hotels:${city}`;
const dataKey = (city: string) => `hotels:${city}:data`;

/** Atomically replaces the cached list for a city. */
export async function saveHotels(city: string, hotels: Hotel[]): Promise<number> {
  const tx = getRedis().multi();
  tx.del(zsetKey(city), dataKey(city));
  if (hotels.length > 0) {
    const zaddArgs: (string | number)[] = [];
    const hsetArgs: string[] = [];
    for (const hotel of hotels) {
      const field = normalizeName(hotel.name);
      zaddArgs.push(hotel.price, field);
      hsetArgs.push(field, JSON.stringify(hotel));
    }
    tx.zadd(zsetKey(city), ...zaddArgs);
    tx.hset(dataKey(city), ...hsetArgs);
    tx.expire(zsetKey(city), config.cacheTtlSeconds);
    tx.expire(dataKey(city), config.cacheTtlSeconds);
  }
  const results = await tx.exec();
  const failed = results?.find(([err]) => err);
  if (failed) throw failed[0];
  return hotels.length;
}

/** Price range filter executed inside Redis. Omitted bounds are open (-inf / +inf); both bounds are inclusive. */
export async function queryHotels(city: string, minPrice?: number, maxPrice?: number): Promise<Hotel[]> {
  const redis = getRedis();
  const min = minPrice === undefined ? '-inf' : String(minPrice);
  const max = maxPrice === undefined ? '+inf' : String(maxPrice);
  const fields = await redis.zrangebyscore(zsetKey(city), min, max);
  if (fields.length === 0) return [];
  const raw = await redis.hmget(dataKey(city), ...fields);
  return raw.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Hotel);
}

export async function pingRedis(): Promise<void> {
  await getRedis().ping();
}
