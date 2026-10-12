import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createResolver, parsePackageSpecifier } from '../src/resolver.js';
import { DEFAULT_EXTENSIONS } from '../src/presets.js';

const root = path.resolve('/project');

const virtualFiles = new Set(
  [
    'src/main.ts',
    'src/components/Cart.vue',
    'src/stores/cart.ts',
    'src/domain/order.ts',
    'src/domain/index.ts',
    'src/api/cart.ts',
  ].map((file) => path.join(root, file)),
);

const resolver = createResolver({
  root,
  aliases: { '@': 'src', '~': 'src', '@domain': 'src/domain' },
  extensions: DEFAULT_EXTENSIONS,
  exists: (file) => virtualFiles.has(file),
});

describe('parsePackageSpecifier', () => {
  it('splits scoped and unscoped packages', () => {
    expect(parsePackageSpecifier('axios')).toEqual({ packageName: 'axios', subpath: '' });
    expect(parsePackageSpecifier('axios/dist/esm')).toEqual({
      packageName: 'axios',
      subpath: 'dist/esm',
    });
    expect(parsePackageSpecifier('@tanstack/vue-query')).toEqual({
      packageName: '@tanstack/vue-query',
      subpath: '',
    });
    expect(parsePackageSpecifier('@firebase/app/dist')).toEqual({
      packageName: '@firebase/app',
      subpath: 'dist',
    });
  });

  it('keeps the node: prefix so builtins can be policed', () => {
    expect(parsePackageSpecifier('node:fs')).toEqual({ packageName: 'node:fs', subpath: '' });
  });
});

describe('createResolver', () => {
  it('resolves relative specifiers, adding extensions', () => {
    expect(resolver('./cart', 'src/stores/main.ts')).toEqual({
      target: 'internal',
      file: 'src/stores/cart.ts',
    });
    expect(resolver('../domain/order', 'src/stores/cart.ts')).toEqual({
      target: 'internal',
      file: 'src/domain/order.ts',
    });
  });

  it('resolves a directory to its index file', () => {
    expect(resolver('@/domain', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/domain/index.ts',
    });
  });

  it('resolves aliases, longest first', () => {
    expect(resolver('@/stores/cart', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/stores/cart.ts',
    });
    expect(resolver('@domain/order', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/domain/order.ts',
    });
    expect(resolver('~/api/cart', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/api/cart.ts',
    });
  });

  it('keeps explicit extensions, including .vue', () => {
    expect(resolver('@/components/Cart.vue', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/components/Cart.vue',
    });
  });

  it('resolves root-absolute specifiers the way Vite serves them', () => {
    expect(resolver('/src/stores/cart.ts', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/stores/cart.ts',
    });
  });

  it('classifies bare specifiers as external', () => {
    expect(resolver('axios', 'src/api/cart.ts')).toEqual({
      target: 'external',
      packageName: 'axios',
      subpath: '',
    });
  });

  it('strips resource queries before resolving', () => {
    expect(resolver('@/stores/cart.ts?raw', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/stores/cart.ts',
    });
  });

  it('treats a leading # as a subpath import, not a hash fragment', () => {
    const withSubpath = createResolver({
      root,
      aliases: { '#api': 'src/api' },
      extensions: DEFAULT_EXTENSIONS,
      exists: (file) => virtualFiles.has(file),
    });
    expect(withSubpath('#api/cart', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/api/cart.ts',
    });
    expect(resolver('#api/cart', 'src/main.ts')).toMatchObject({
      target: 'unresolved',
      reason: expect.stringContaining('aliases'),
    });
  });

  it('strips a trailing hash fragment', () => {
    expect(resolver('@/stores/cart.ts#named', 'src/main.ts')).toEqual({
      target: 'internal',
      file: 'src/stores/cart.ts',
    });
  });

  it('ignores assets, virtual modules and data URLs', () => {
    for (const specifier of [
      './styles.css',
      '@/assets/logo.svg',
      'virtual:uno.css',
      'data:text/javascript,',
      'https://esm.sh/vue',
    ]) {
      expect(resolver(specifier, 'src/main.ts').target).toBe('ignored');
    }
  });

  it('reports unresolved internal specifiers', () => {
    expect(resolver('@/does/not/exist', 'src/main.ts')).toMatchObject({
      target: 'unresolved',
    });
  });

  it('ignores files resolved outside the project root', () => {
    const outside = path.resolve(root, '..', 'other', 'thing.ts');
    const withOutside = createResolver({
      root,
      aliases: {},
      extensions: DEFAULT_EXTENSIONS,
      exists: (file) => file === outside,
    });
    expect(withOutside('../../other/thing', 'src/main.ts')).toEqual({
      target: 'ignored',
      reason: 'outside project root',
    });
  });
});
