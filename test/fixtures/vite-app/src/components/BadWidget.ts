// presentation -> infrastructure: the plugin must fail the build on this.
import { get } from '@/api/http';

export const render = () => get('/api/orders');
