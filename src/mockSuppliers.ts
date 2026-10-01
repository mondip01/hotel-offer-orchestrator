import { Router } from 'express';
import type { SupplierHotel, SupplierId } from './types';

const h = (hotelId: string, name: string, price: number, city: string, commissionPct: number): SupplierHotel => ({
  hotelId, name, price, city, commissionPct,
});

// Names overlap between A and B on purpose (Holtin, Radison, Taj Palace, Lemon Tree, Trident ...)
export const SUPPLIER_DATA: Record<SupplierId, SupplierHotel[]> = {
  A: [
    h('a1', 'Holtin', 6000, 'delhi', 10),
    h('a2', 'Radison', 5900, 'delhi', 13),
    h('a3', 'Taj Palace', 12000, 'delhi', 12),
    h('a4', 'Lemon Tree', 4200, 'delhi', 11), // price tie with B -> higher commission wins (B, 12%)
    h('a5', 'Ibis', 3800, 'delhi', 9),
    h('a6', 'Bloom Suites', 2900, 'delhi', 14), // only in A
    h('a7', 'Trident', 9500, 'mumbai', 12),
    h('a8', 'Holtin', 6500, 'mumbai', 10),
    h('a9', 'Sea Lounge Inn', 3100, 'mumbai', 15),
  ],
  B: [
    h('b1', 'Holtin', 5340, 'delhi', 20),
    h('b2', 'Radison', 6200, 'delhi', 15),
    h('b3', 'Taj Palace', 11500, 'delhi', 10),
    h('b4', 'Lemon Tree', 4200, 'delhi', 12),
    h('b5', 'The Leela', 18000, 'delhi', 8), // only in B
    h('b6', 'Zostel', 1500, 'delhi', 18), // only in B
    h('b7', 'Trident', 9100, 'mumbai', 14),
    h('b8', 'Holtin', 6900, 'mumbai', 16),
  ],
};

/** In-memory "outage" switches so the failure path can be demonstrated (see README / Postman). */
const down: Record<SupplierId, boolean> = { A: false, B: false };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockSupplierRouter(): Router {
  const router = Router();

  (['A', 'B'] as SupplierId[]).forEach((id) => {
    router.get(`/supplier${id}/hotels`, async (req, res) => {
      await sleep(50 + Math.random() * 100); // simulate network latency
      if (down[id]) {
        res.status(503).json({ error: `Supplier ${id} is unavailable (simulated outage)` });
        return;
      }
      const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : undefined;
      res.json(city ? SUPPLIER_DATA[id].filter((x) => x.city === city) : SUPPLIER_DATA[id]);
    });
  });

  // Test helper: POST /admin/suppliers/A/status  {"down": true}
  router.post('/admin/suppliers/:id/status', (req, res) => {
    const id = String(req.params.id).toUpperCase();
    if (id !== 'A' && id !== 'B') {
      res.status(404).json({ error: 'Unknown supplier, use A or B' });
      return;
    }
    if (typeof req.body?.down !== 'boolean') {
      res.status(400).json({ error: 'Body must be {"down": true|false}' });
      return;
    }
    down[id as SupplierId] = req.body.down;
    res.json({ supplier: id, down: req.body.down });
  });

  return router;
}
