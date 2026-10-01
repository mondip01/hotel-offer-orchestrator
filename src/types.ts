export type SupplierId = 'A' | 'B';

/** Shape returned by the (mock) supplier APIs. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** Shape returned to API clients. */
export interface Hotel {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface WorkflowInput {
  city: string;
}
