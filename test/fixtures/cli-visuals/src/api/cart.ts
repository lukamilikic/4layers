// Infrastructure layer.
import type { Cart } from '@/domain/cart';

import { useCart } from '@/stores/cart';

export async function fetchCart(): Promise<Cart> {
  useCart();
  const response = await fetch('/api/cart');
  return (await response.json()) as Cart;
}
