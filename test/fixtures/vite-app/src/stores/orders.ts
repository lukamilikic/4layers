import { get } from '@/api/http';
import type { Order } from '@/domain/order';

export const loadOrders = () => get<Order[]>('/api/orders');
