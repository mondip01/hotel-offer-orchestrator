# Hotel Offer Orchestrator

Aggregates overlapping hotel offers from two mock suppliers, de-duplicates hotels by name, keeps the **cheapest** offer per hotel, stores the result in **Redis**, and supports **price-range filtering inside Redis**. The orchestration is done by a **Temporal** workflow.

**Stack:** Node.js 20 (TypeScript) · Express · Temporal · Redis · Docker Compose

---

## Architecture

```
Client ── GET /api/hotels?city=delhi[&minPrice&maxPrice]
   │
   ▼
Express API ──starts──► Temporal workflow: hotelOfferWorkflow(city)
   │                        │  (runs on the Temporal worker)
   │                        ├─► activity fetchSupplierHotels(A) ─┐ in parallel
   │                        ├─► activity fetchSupplierHotels(B) ─┘ (retry 3x, exp. backoff)
   │                        ├─► dedupe by name → cheapest wins
   │                        └─► activity saveHotelsToRedis(city, list)
   ▼
 no price params → return the workflow result
 minPrice/maxPrice → Redis ZRANGEBYSCORE (filter executed by Redis) → return
```

The two mock supplier endpoints (`/supplierA/hotels`, `/supplierB/hotels`) are served by the same API process; the worker's activities call them over HTTP exactly as they would call a real supplier.

### Dedupe rules
- Hotels are matched by name, case/whitespace-insensitive (`"Holtin"` == `" holtin "`).
- Cheaper price wins. If only one supplier has the hotel, it is used.
- Exact price tie → higher `commissionPct` wins (documented assumption; the brief doesn't specify).
- Output is sorted by price ascending.

### Redis data model (per city)
| Key | Type | Purpose |
|---|---|---|
| `hotels:<city>` | ZSET (member = normalized name, score = **price**) | price range queries |
| `hotels:<city>:data` | HASH (name → JSON of the hotel) | hotel details |

`minPrice`/`maxPrice` are applied with `ZRANGEBYSCORE key min max` (inclusive bounds; a missing bound is `-inf`/`+inf`), then details are loaded with one `HMGET`. The list is replaced atomically (`MULTI/EXEC`) on each workflow run and expires after `CACHE_TTL_SECONDS` (default 300).

### Resilience
- Each supplier call is an activity with a 10 s timeout and up to 3 attempts (500 ms → 1 s backoff).
- If **one** supplier fails after retries, the workflow continues with the other (partial result, logged as a warning).
- If **both** fail, the workflow fails with `AllSuppliersFailed` and the API returns **502**.

---

## Run with Docker (recommended)

Prerequisites: Docker + Docker Compose v2.

```bash
docker compose up --build
```

This starts: `redis`, `postgres` + `temporal` (+ `temporal-ui`), the `api` and the `worker`. First start takes ~30-60 s while Temporal initialises its schema (the API and worker retry the connection automatically).

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Temporal UI (inspect workflows) | http://localhost:8080 |

Try it:

```bash
curl "http://localhost:3000/api/hotels?city=delhi"
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=3000&maxPrice=6000"
curl "http://localhost:3000/health"
```

Stop / clean up: `docker compose down -v`

### Sample response – `GET /api/hotels?city=delhi`
```json
[
  { "name": "Zostel",       "price": 1500,  "supplier": "Supplier B", "commissionPct": 18 },
  { "name": "Bloom Suites", "price": 2900,  "supplier": "Supplier A", "commissionPct": 14 },
  { "name": "Ibis",         "price": 3800,  "supplier": "Supplier A", "commissionPct": 9 },
  { "name": "Lemon Tree",   "price": 4200,  "supplier": "Supplier B", "commissionPct": 12 },
  { "name": "Holtin",       "price": 5340,  "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison",      "price": 5900,  "supplier": "Supplier A", "commissionPct": 13 },
  { "name": "Taj Palace",   "price": 11500, "supplier": "Supplier B", "commissionPct": 10 },
  { "name": "The Leela",    "price": 18000, "supplier": "Supplier B", "commissionPct": 8 }
]
```
Mock data: cities `delhi` and `mumbai`; any other city returns `[]`.

---

## Run locally (without Docker for the app)

Prerequisites: Node 20+, a Redis and a Temporal server. Easiest is to start only the infrastructure from compose:

```bash
docker compose up -d redis postgres temporal temporal-ui
npm install
cp .env.example .env        # defaults already point at localhost
npm run build
npm run start:worker &      # terminal 1
npm run start:api           # terminal 2
```
(`npm run dev:api` / `npm run dev:worker` run straight from TypeScript via ts-node.)

Unit tests (dedupe logic): `npm test`

### Environment variables
| Var | Default | Description |
|---|---|---|
| `PORT` | 3000 | API port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection |
| `TEMPORAL_ADDRESS` | localhost:7233 | Temporal frontend |
| `TEMPORAL_NAMESPACE` | default | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | hotel-offers | Worker task queue |
| `SUPPLIER_BASE_URL` | http://localhost:PORT | Base URL the activities use for suppliers |
| `SUPPLIER_TIMEOUT_MS` | 3000 | Per-call supplier timeout |
| `CACHE_TTL_SECONDS` | 300 | Redis TTL of a city's list |

---

## API

### `GET /api/hotels`
| Param | Required | Notes |
|---|---|---|
| `city` | yes | case-insensitive |
| `minPrice` | no | inclusive, number ≥ 0 |
| `maxPrice` | no | inclusive, number ≥ 0 |

Responses: `200` array of hotels (`[]` when nothing matches) · `400` missing/invalid params or `minPrice > maxPrice` · `502` all suppliers failed.

### `GET /health` (bonus)
Reports each supplier, Redis and Temporal.
```json
{
  "status": "ok",
  "suppliers": { "Supplier A": { "status": "up", "responseMs": 92 }, "Supplier B": { "status": "up", "responseMs": 71 } },
  "redis": { "status": "up" },
  "temporal": { "status": "up" }
}
```
`status` is `ok` (all up), `degraded` (one supplier down, HTTP 200) or `down` (Redis/Temporal down or both suppliers down, HTTP 503).

### Mock suppliers
`GET /supplierA/hotels?city=delhi`, `GET /supplierB/hotels?city=delhi` (the `city` filter is optional).

### Simulating a supplier outage
```bash
curl -X POST localhost:3000/admin/suppliers/A/status -H 'Content-Type: application/json' -d '{"down": true}'
curl "localhost:3000/api/hotels?city=delhi"     # served from Supplier B only
curl -X POST localhost:3000/admin/suppliers/A/status -H 'Content-Type: application/json' -d '{"down": false}'
```

### Logging
Structured JSON logs from the API (per request), workflow (`log` from `@temporalio/workflow`) and activities (`Context.current().log`: supplier, city, attempt, latency, counts). Workflow history and retries are visible in the Temporal UI.

---

## Postman

Import `postman/Hotel-Offer-Orchestrator.postman_collection.json` (variable `baseUrl` = `http://localhost:3000`). Folders:

1. Happy path – `city=delhi` with overlap assertions (Holtin → B @ 5340, Radison → A @ 5900), `city=mumbai`, `/health`
2. Price range filter – min+max, min only, max only, empty range
3. Edge cases – city with no results, missing city, invalid ranges
4. **Supplier A down** (optional) – run the folder in order; it restores the supplier at the end
5. **Both suppliers down** (optional) – expects 502 / 503; run in order

Run everything with the Collection Runner, or via CLI: `npx newman run postman/Hotel-Offer-Orchestrator.postman_collection.json`

## Project layout
```
src/server.ts         Express API, /health, error handling
src/mockSuppliers.ts  Mock Supplier A/B endpoints + outage toggle
src/workflows.ts      Temporal workflow (parallel calls → dedupe → save)
src/activities.ts     fetchSupplierHotels, saveHotelsToRedis
src/dedupe.ts         Pure dedupe/best-price logic
src/redisStore.ts     Redis save + ZRANGEBYSCORE price filtering
src/worker.ts         Temporal worker
test/                 Unit tests
Dockerfile, docker-compose.yml
postman/              Postman collection
```
