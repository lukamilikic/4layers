// Infrastructure layer: HTTP is allowed here, UI state is not.
import axios from 'axios';
import type { Order } from '@/domain/order';
import { useCart } from '@/stores/cart'; // violation: layer-dependency

export async function fetchCart(): Promise<Order> {
  useCart();
  const { data } = await axios.get<Order>('/api/cart');
  return data;
}
