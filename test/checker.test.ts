import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { check, createChecker } from '../src/checker.js';
import { resolveConfig } from '../src/config.js';
import type { CheckResult, RuleId } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sample');

const rulesFor = (result: CheckResult, file: string): Array<[RuleId, string]> =>
  result.violations
    .filter((violation) => violation.file === file)
    .map((violation) => [violation.rule, violation.specifier]);

describe('check (classic preset)', () => {
  it('reports exactly the violations the fixture is built around', async () => {
    const result = await check({ root: fixture, config: { include: ['src/**/*.{ts,vue}'] } });

    expect(rulesFor(result, 'src/components/CartView.vue')).toEqual([
      ['layer-dependency', '@/api/cart'],
      ['package-boundary', 'axios'],
    ]);
    expect(rulesFor(result, 'src/domain/order.ts')).toEqual([
      ['package-boundary', 'vue'],
      ['layer-dependency', '@/api/cart'],
    ]);
    expect(rulesFor(result, 'src/api/cart.ts')).toEqual([['layer-dependency', '@/stores/cart']]);

    // Legal files stay quiet.
    expect(rulesFor(result, 'src/stores/cart.ts')).toEqual([]);
    expect(rulesFor(result, 'src/domain/pricing.ts')).toEqual([]);
  });

  it('assigns layers from the conventional directory names', async () => {
    const result = await check({ root: fixture, config: { include: ['src/**/*.{ts,vue}'] } });
    expect(result.files).toMatchObject({
      'src/components/CartView.vue': 'presentation',
      'src/stores/cart.ts': 'application',
      'src/domain/order.ts': 'domain',
      'src/api/cart.ts': 'infrastructure',
      'src/utils/noise.ts': null,
    });
  });

  it('counts errors, not warnings, under the classic preset', async () => {
    const result = await check({ root: fixture, config: { include: ['src/**/*.{ts,vue}'] } });
    expect(result.errorCount).toBe(5);
    expect(result.warningCount).toBe(0);
  });

  it('aggregates layer edges and flags the illegal ones', async () => {
    const result = await check({ root: fixture, config: { include: ['src/**/*.{ts,vue}'] } });
    const edge = (from: string, to: string) =>
      result.edges.find((candidate) => candidate.from === from && candidate.to === to);

    expect(edge('presentation', 'application')).toMatchObject({ allowed: true });
    expect(edge('presentation', 'infrastructure')).toMatchObject({ allowed: false, count: 1 });
    expect(edge('domain', 'infrastructure')).toMatchObject({ allowed: false });
    expect(edge('infrastructure', 'application')).toMatchObject({ allowed: false });
  });

  it('collects stats', async () => {
    const result = await check({ root: fixture, config: { include: ['src/**/*.{ts,vue}'] } });
    expect(result.stats.filesScanned).toBe(7);
    expect(result.stats.filesByLayer).toMatchObject({ domain: 2, presentation: 1 });
    expect(result.stats.importsScanned).toBeGreaterThan(5);
  });
});

describe('presets', () => {
  it('turns everything into warnings under relaxed', async () => {
    const result = await check({
      root: fixture,
      config: { extends: 'relaxed', include: ['src/**/*.{ts,vue}'] },
    });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('ignores type-only edges under relaxed', async () => {
    const relaxed = await check({
      root: fixture,
      config: { extends: 'relaxed', include: ['src/**/*.{ts,vue}'] },
    });
    expect(
      relaxed.violations.some((violation) => violation.typeOnly),
    ).toBe(false);
  });

  it('flags unassigned files and the application -> infrastructure edge under strict', async () => {
    const result = await check({
      root: fixture,
      config: { extends: 'strict', include: ['src/**/*.{ts,vue}'] },
    });
    const rules = result.violations.map((violation) => violation.rule);
    expect(rules).toContain('unassigned-file');
    expect(rulesFor(result, 'src/stores/cart.ts')).toEqual([
      ['layer-dependency', '@/api/cart'],
    ]);
    // Under strict, the domain layer may not import any package at all.
    expect(rulesFor(result, 'src/domain/order.ts')).toEqual([
      ['package-boundary', 'vue'],
      ['layer-dependency', '@/api/cart'],
    ]);
  });
});

describe('checkFile', () => {
  const config = resolveConfig(
    { include: ['src/**/*.{ts,vue}'] },
    { root: fixture },
  );
  const checker = createChecker(config);

  it('checks a single file from source, without touching disk', () => {
    const violations = checker.checkFile(
      'src/components/Widget.vue',
      ['<script setup lang="ts">', "import { fetchCart } from '@/api/cart';", '</script>'].join('\n'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: 'layer-dependency',
      fromLayer: 'presentation',
      toLayer: 'infrastructure',
      line: 2,
    });
    expect(violations[0]?.hint).toContain('application');
  });

  it('honours a next-line disable directive', () => {
    const violations = checker.checkFile(
      'src/components/Widget.vue',
      [
        '<script setup lang="ts">',
        '// 4layers-disable-next-line layer-dependency',
        "import { fetchCart } from '@/api/cart';",
        '</script>',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });

  it('honours a file-level disable directive', () => {
    const violations = checker.checkFile(
      'src/domain/legacy.ts',
      ['// 4layers-disable-file', "import axios from 'axios';"].join('\n'),
    );
    expect(violations).toEqual([]);
  });

  it('accepts an absolute path', () => {
    const violations = checker.checkFile(
      path.join(fixture, 'src', 'domain', 'thing.ts'),
      "import axios from 'axios';",
    );
    expect(violations[0]).toMatchObject({ rule: 'package-boundary', fromLayer: 'domain' });
  });

  it('explains which glob claimed a file', () => {
    expect(checker.explain('src/stores/cart.ts')).toMatchObject({
      layer: 'application',
      pattern: 'src/stores/**',
      canImport: ['domain', 'infrastructure'],
    });
    expect(checker.explain('src/utils/noise.ts').layer).toBe(null);
  });

  it('prefers the most specific glob over declaration order', () => {
    // `**/*.vue` belongs to presentation, but an explicit domain glob wins.
    expect(checker.explain('src/domain/Weird.vue').layer).toBe('domain');
  });
});

describe('composition layer', () => {
  const checker = createChecker(resolveConfig({}, { root: fixture }));

  it('owns the router and the app entry', () => {
    expect(checker.explain('src/router/index.ts').layer).toBe('composition');
    expect(checker.explain('src/main.ts').layer).toBe('composition');
  });

  it('may import every layer, including lazy-loaded views', () => {
    const code = [
      "import { useCart } from '@/stores/cart';",
      "import { fetchCart } from '@/api/cart';",
      "const Cart = () => import('@/components/CartView.vue');",
    ].join('\n');
    expect(checker.checkFile('src/router/index.ts', code)).toEqual([]);
  });

  it('may not be imported back, with a useRouter hint', () => {
    const [violation] = checker.checkFile(
      'src/api/http.ts',
      "import router from '@/router/index.ts';",
    );
    expect(violation).toMatchObject({ fromLayer: 'infrastructure', toLayer: 'composition' });
    expect(violation?.hint).toContain('useRouter');
  });

  it('recognises a singular src/store directory as application', () => {
    expect(checker.explain('src/store/useAppStore.ts').layer).toBe('application');
  });
});

describe('custom layers', () => {
  it('supports extra layers and wildcard permissions', () => {
    const config = resolveConfig(
      {
        include: ['src/**/*.ts'],
        layers: {
          shared: { files: ['src/utils/**'], canImport: [] },
          presentation: { canImport: ['application', 'domain', 'shared'] },
        },
      },
      { root: fixture },
    );
    const checker = createChecker(config);

    expect(checker.explain('src/utils/noise.ts').layer).toBe('shared');
    expect(
      checker.checkFile('src/components/A.vue', "import { noop } from '@/utils/noise';"),
    ).toEqual([]);
    expect(
      checker.checkFile('src/utils/noise.ts', "import { useCart } from '@/stores/cart';"),
    ).toHaveLength(1);
  });

  it('reports a canImport reference to a layer that does not exist', () => {
    const config = resolveConfig(
      { layers: { presentation: { canImport: ['nope'] } } },
      { root: fixture },
    );
    const result = createChecker(config).checkFiles([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ rule: 'unknown-layer', specifier: 'nope' });
  });
});
