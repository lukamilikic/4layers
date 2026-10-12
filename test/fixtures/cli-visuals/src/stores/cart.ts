// Application layer: may use domain and infrastructure.
import { fetchCart } from '@/api/cart';
import { totalOf, type Cart } from '@/domain/cart';

export function useCart() {
  const cart: Cart = { lines: [] };
  return { cart, total: () => totalOf(cart), refresh: fetchCart };
}
