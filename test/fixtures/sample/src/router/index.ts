// Composition root: wires views to routes, so it may import every layer.
import { useCart } from '@/stores/cart';

export const routes = [
  { path: '/cart', component: () => import('@/components/CartView.vue'), beforeEnter: useCart },
];
