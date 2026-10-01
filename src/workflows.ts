import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import { selectBestOffers } from './dedupe';
import type { Hotel, SupplierId, WorkflowInput } from './types';

const { fetchSupplierHotels, saveHotelsToRedis } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { initialInterval: '500ms', backoffCoefficient: 2, maximumAttempts: 3 },
});

/**
 * 1. Call Supplier A and Supplier B in parallel
 * 2. Tolerate one supplier failing (use the other); fail only if both fail
 * 3. Dedupe by hotel name, keeping the cheapest offer
 * 4. Save the result into Redis and return it
 */
export async function hotelOfferWorkflow({ city }: WorkflowInput): Promise<Hotel[]> {
  const suppliers: SupplierId[] = ['A', 'B'];
  const results = await Promise.allSettled(suppliers.map((s) => fetchSupplierHotels(s, city)));

  const offers: Hotel[] = [];
  const failed: SupplierId[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      offers.push(...r.value);
    } else {
      failed.push(suppliers[i]);
      log.error('Supplier failed after retries', { supplier: suppliers[i], city, reason: String(r.reason?.message ?? r.reason) });
    }
  });

  if (failed.length === suppliers.length) {
    // ApplicationFailure fails the workflow cleanly (a plain Error would only fail the workflow *task* and retry forever)
    throw ApplicationFailure.nonRetryable('All suppliers failed', 'AllSuppliersFailed');
  }
  if (failed.length > 0) {
    log.warn('Continuing with partial supplier results', { city, failedSuppliers: failed });
  }

  const best = selectBestOffers(offers);
  await saveHotelsToRedis(city, best);
  log.info('Workflow complete', { city, offers: offers.length, deduped: best.length });
  return best;
}
