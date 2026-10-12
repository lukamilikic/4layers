// Domain layer: pure.
export interface Cart {
  lines: Array<{ price: number }>;
}

export const totalOf = (cart: Cart): number =>
  cart.lines.reduce((sum, line) => sum + line.price, 0);
