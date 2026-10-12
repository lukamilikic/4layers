// Composition root: may import every layer.
import { useCart } from '@/stores/cart';

export const routes = [
  { path: '/cart', component: () => import('@/views/CartPage.vue'), beforeEnter: useCart },
];
