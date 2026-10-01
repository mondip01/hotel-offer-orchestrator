import type { Hotel } from './types';

/** Case/whitespace-insensitive key so "Holtin", " holtin " and "HOLTIN" are the same hotel. */
export const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Collapse offers from all suppliers into one offer per hotel name.
 *  - cheapest price wins
 *  - on an exact price tie, the higher commission wins (better margin for us)
 *  - result is sorted by price ascending (then name) for deterministic output
 *
 * Pure function with no Node APIs, so it is safe to import inside the Temporal workflow sandbox.
 */
export function selectBestOffers(offers: Hotel[]): Hotel[] {
  const best = new Map<string, Hotel>();
  for (const offer of offers) {
    const key = normalizeName(offer.name);
    const current = best.get(key);
    if (
      !current ||
      offer.price < current.price ||
      (offer.price === current.price && offer.commissionPct > current.commissionPct)
    ) {
      best.set(key, offer);
    }
  }
  return [...best.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
