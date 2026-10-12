# Example: Vue shop

A reference layout for a Vue 3 app checked by 4layers.

```
src/
├── components/        presentation   CartLine.vue, PriceTag.vue
├── views/             presentation   CartView.vue, CheckoutView.vue
├── stores/            application    cart.ts (Pinia)
├── queries/           application    useProducts.ts (TanStack Query)
├── router/            application    index.ts
├── domain/            domain         cart.ts, money.ts, ports.ts
├── api/               infrastructure http.ts, productsApi.ts
└── storage/           infrastructure cartStorage.ts (localStorage)
```

The flow for "add to cart":

1. `CartView.vue` (presentation) calls `cart.add(product)` on the store.
2. `stores/cart.ts` (application) runs the domain rule `addLine(cart, product)`
   and persists through `cartStorage`.
3. `domain/cart.ts` (domain) is pure: it computes the new cart and enforces
   rules like "max 10 of one item". It declares a `CartRepository` port in
   `domain/ports.ts`.
4. `storage/cartStorage.ts` (infrastructure) implements `CartRepository` with
   `localStorage`.

Copy `4layers.config.mjs` and `vite.config.ts` into your own project as a
starting point.
