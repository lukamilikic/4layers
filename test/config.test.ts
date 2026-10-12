import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defineConfig, findConfigFile, inferAliases, loadConfig, resolveConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sample');

describe('defineConfig', () => {
  it('returns its input untouched', () => {
    const config = defineConfig({ extends: 'strict' });
    expect(config).toEqual({ extends: 'strict' });
  });
});

describe('findConfigFile / loadConfig', () => {
  it('finds the fixture config and loads it', async () => {
    expect(findConfigFile(fixture)).toBe(path.join(fixture, '4layers.config.json'));
    const loaded = await loadConfig(fixture);
    expect(loaded.user.extends).toBe('classic');
    expect(loaded.root).toBe(fixture);
  });

  it('returns an empty config when nothing is found', async () => {
    const loaded = await loadConfig(path.resolve('/'));
    expect(loaded.configFile).toBe(null);
    expect(loaded.user).toEqual({});
  });

  it('throws on an explicit path that does not exist', async () => {
    await expect(loadConfig(fixture, 'nope.config.mjs')).rejects.toThrow(/not found/i);
  });
});

describe('inferAliases', () => {
  it('reads tsconfig paths', () => {
    expect(inferAliases(fixture)).toEqual({ '@': 'src' });
  });

  it('falls back to the conventional @ and ~ aliases', () => {
    expect(inferAliases(path.join(here, 'fixtures'))).toEqual({ '@': 'src', '~': 'src' });
  });
});

describe('resolveConfig', () => {
  it('fills in preset defaults', () => {
    const config = resolveConfig({}, { root: fixture });
    expect(config.extends).toBe('classic');
    expect(config.layerNames).toEqual([
      'presentation',
      'application',
      'domain',
      'infrastructure',
    ]);
    expect(config.layers.domain?.canImport).toEqual([]);
    expect(config.severity['layer-dependency']).toBe('error');
    expect(config.typeOnlyImports).toBe('check');
  });

  it('merges a layer override without dropping the preset packages policy', () => {
    const config = resolveConfig(
      { layers: { domain: { files: ['src/core/**'] } } },
      { root: fixture },
    );
    expect(config.layers.domain?.files).toEqual(['src/core/**']);
    expect(config.layers.domain?.packages?.deny).toContain('vue');
  });

  it('lets a user deny-list replace the preset one', () => {
    const config = resolveConfig(
      { layers: { domain: { packages: { deny: ['lodash'] } } } },
      { root: fixture },
    );
    expect(config.layers.domain?.packages?.deny).toEqual(['lodash']);
  });

  it('adds new layers', () => {
    const config = resolveConfig(
      { layers: { shared: { files: ['src/shared/**'] } } },
      { root: fixture },
    );
    expect(config.layerNames).toContain('shared');
    expect(config.layers.shared?.canImport).toEqual([]);
  });

  it('resolves a relative root against the config file directory', () => {
    const config = resolveConfig({ root: 'src' }, { root: fixture });
    expect(config.root).toBe(path.join(fixture, 'src'));
  });

  it('applies severity overrides', () => {
    const config = resolveConfig({ severity: { 'unassigned-file': 'warn' } }, { root: fixture });
    expect(config.severity['unassigned-file']).toBe('warn');
  });

  it('rejects an unknown preset', () => {
    expect(() => resolveConfig({ extends: 'nope' as never })).toThrow(/Unknown preset/);
  });

  it('rejects an unknown rule name', () => {
    expect(() =>
      resolveConfig({ severity: { 'no-such-rule': 'error' } as never }),
    ).toThrow(/Unknown rule/);
  });

  it('rejects an invalid severity', () => {
    expect(() =>
      resolveConfig({ severity: { 'layer-dependency': 'fatal' as never } }),
    ).toThrow(/Invalid severity/);
  });

  it('rejects a new layer without files', () => {
    expect(() => resolveConfig({ layers: { ghost: { canImport: [] } } })).toThrow(
      /Layer "ghost".*files/s,
    );
  });
});
