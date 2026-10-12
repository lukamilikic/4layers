import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_EXCLUDE } from '../src/presets.js';
import { shouldScan, walkProject } from '../src/walk.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sample');

describe('walkProject', () => {
  it('returns sorted, project-relative POSIX paths', () => {
    const files = walkProject({
      root: fixture,
      include: ['src/**/*.{ts,vue}'],
      exclude: DEFAULT_EXCLUDE,
    });
    expect(files).toEqual([
      'src/api/cart.ts',
      'src/components/CartView.vue',
      'src/domain/order.ts',
      'src/domain/pricing.ts',
      'src/router/index.ts',
      'src/stores/cart.ts',
      'src/utils/noise.ts',
    ]);
  });

  it('honours include patterns', () => {
    const files = walkProject({
      root: fixture,
      include: ['**/*.vue'],
      exclude: DEFAULT_EXCLUDE,
    });
    expect(files).toEqual(['src/components/CartView.vue']);
  });

  it('honours exclude patterns, pruning whole directories', () => {
    const files = walkProject({
      root: fixture,
      include: ['src/**/*.ts'],
      exclude: [...DEFAULT_EXCLUDE, '**/domain/**'],
    });
    expect(files).not.toContain('src/domain/order.ts');
    expect(files).toContain('src/stores/cart.ts');
  });

  it('respects maxFiles', () => {
    const files = walkProject({
      root: fixture,
      include: ['**/*'],
      exclude: [],
      maxFiles: 2,
    });
    expect(files).toHaveLength(2);
  });
});

describe('shouldScan', () => {
  const options = { include: ['src/**/*.{ts,vue}'], exclude: DEFAULT_EXCLUDE };

  it('matches the walk behaviour for single files', () => {
    expect(shouldScan('src/stores/cart.ts', options)).toBe(true);
    expect(shouldScan('src/stores/cart.spec.ts', options)).toBe(false);
    expect(shouldScan('src/types/api.d.ts', options)).toBe(false);
    expect(shouldScan('vite.config.ts', options)).toBe(false);
  });

  it('accepts Windows separators', () => {
    expect(shouldScan('src\\stores\\cart.ts', options)).toBe(true);
  });
});
