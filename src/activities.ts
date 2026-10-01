import { ApplicationFailure, Context } from '@temporalio/activity';
import { config } from './config';
import { saveHotels } from './redisStore';
import type { Hotel, SupplierHotel, SupplierId } from './types';

const isValid = (h: Partial<SupplierHotel>): h is SupplierHotel =>
  typeof h?.name === 'string' &&
  h.name.trim() !== '' &&
  typeof h.price === 'number' &&
  Number.isFinite(h.price) &&
  h.price >= 0 &&
  typeof h.commissionPct === 'number' &&
  Number.isFinite(h.commissionPct);

/** Calls one supplier and maps its response into our Hotel shape. Retried by Temporal on failure. */
export async function fetchSupplierHotels(supplier: SupplierId, city: string): Promise<Hotel[]> {
  const { log, info } = Context.current();
  const url = `${config.supplierBaseUrl}/supplier${supplier}/hotels?city=${encodeURIComponent(city)}`;
  const started = Date.now();
  log.info('Calling supplier', { supplier, city, url, attempt: info.attempt });

  const res = await fetch(url, { signal: AbortSignal.timeout(config.supplierTimeoutMs) });
  if (!res.ok) {
    log.warn('Supplier returned an error status', { supplier, status: res.status });
    throw new Error(`Supplier ${supplier} responded with HTTP ${res.status}`);
  }

  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw ApplicationFailure.nonRetryable(`Supplier ${supplier} returned a malformed payload`, 'MalformedSupplierResponse');
  }

  const hotels = (body as Partial<SupplierHotel>[])
    .filter(isValid)
    .filter((h) => h.city?.toLowerCase() === city.toLowerCase())
    .map<Hotel>((h) => ({
      name: h.name.trim(),
      price: h.price,
      supplier: `Supplier ${supplier}`,
      commissionPct: h.commissionPct,
    }));

  log.info('Supplier call succeeded', { supplier, city, count: hotels.length, ms: Date.now() - started });
  return hotels;
}

/** Persists the deduplicated list into Redis (sorted set by price + hash of details). */
export async function saveHotelsToRedis(city: string, hotels: Hotel[]): Promise<number> {
  const saved = await saveHotels(city, hotels);
  Context.current().log.info('Saved hotels to Redis', { city, count: saved });
  return saved;
}
