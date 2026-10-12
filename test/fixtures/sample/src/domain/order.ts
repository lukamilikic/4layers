// Domain layer: must stay framework-agnostic and dependency-free.
import { ref } from 'vue'; // violation: package-boundary
import { fetchCart } from '@/api/cart'; // violation: layer-dependency

export interface Order {
  lines: Array<{ id: string; title: string; price: number }>;
}

export function totalOf(order: Order): number {
  return order.lines.reduce((sum, line) => sum + line.price, 0);
}

export const cached = ref(fetchCart);
