// Application layer: orchestrates domain + infrastructure. All edges are legal.
import { fetchCart } from '@/api/cart';
import { totalOf, type Order } from '@/domain/order';

export function useCart() {
  const lines: Order['lines'] = [];
  return { lines, total: () => totalOf({ lines }), refresh: fetchCart };
}
