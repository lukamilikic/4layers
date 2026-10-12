import { loadOrders } from '@/stores/orders';

export const render = async () => (await loadOrders()).length;
