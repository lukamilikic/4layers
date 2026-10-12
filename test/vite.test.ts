import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Plugin, type ResolvedConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_EXCLUDE } from '../src/presets.js';
import { fourLayers, type FourLayersPluginOptions } from '../src/vite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, 'fixtures', 'vite-app');

function viteConfig(plugin: Plugin) {
  return {
    root: app,
    logLevel: 'silent' as const,
    resolve: { alias: { '@': path.join(app, 'src') } },
    build: {
      write: false,
      lib: { entry: path.join(app, 'src', 'main.ts'), formats: ['es' as const] },
    },
    plugins: [plugin],
  };
}

/**
 * Drive the plugin's hooks directly, the way Vite does, without starting a
 * dev server. `configResolved` and `transform` are the two hooks that matter.
 */
async function driveHooks(
  options: FourLayersPluginOptions,
  command: 'serve' | 'build',
  file: string,
  code: string,
) {
  const plugin = fourLayers(options);
  const resolved = {
    root: app,
    command,
    resolve: { alias: [{ find: '@', replacement: path.join(app, 'src') }] },
  } as unknown as ResolvedConfig;

  const configResolved = plugin.configResolved as (config: ResolvedConfig) => Promise<void>;
  await configResolved.call(plugin as never, resolved);

  const warn = vi.fn();
  const transform = plugin.transform as unknown as (
    this: { warn: typeof warn },
    code: string,
    id: string,
  ) => unknown;

  let thrown: Error | null = null;
  try {
    transform.call({ warn }, code, path.join(app, file));
  } catch (error) {
    thrown = error as Error;
  }
  return { warn, thrown };
}

describe('fourLayers vite plugin', () => {
  it('is a pre-enforced plugin with a stable name', () => {
    const plugin = fourLayers();
    expect(plugin.name).toBe('vite-plugin-4layers');
    expect(plugin.enforce).toBe('pre');
  });

  it('fails a real vite build on a layer violation', async () => {
    await expect(build(viteConfig(fourLayers()))).rejects.toThrow(/4layers/);
  });

  it('lets a clean build through', async () => {
    const plugin = fourLayers({
      config: { exclude: [...DEFAULT_EXCLUDE, 'src/components/BadWidget.ts'] },
    });
    await expect(
      build({
        ...viteConfig(plugin),
        build: {
          write: false,
          lib: {
            entry: path.join(app, 'src', 'components', 'GoodWidget.ts'),
            formats: ['es' as const],
          },
        },
      }),
    ).resolves.toBeDefined();
  });

  it('reports each violation once in a build, not again per module', async () => {
    const plugin = fourLayers({ build: 'warn' });
    const warnings: string[] = [];
    await build({
      ...viteConfig(plugin),
      logLevel: 'warn',
      customLogger: {
        info: () => {},
        warn: (message: string) => warnings.push(message),
        warnOnce: (message: string) => warnings.push(message),
        error: () => {},
        clearScreen: () => {},
        hasErrorLogged: () => false,
        hasWarned: false,
      },
    });
    const reports = warnings.filter((message) => message.includes('BadWidget.ts'));
    expect(reports).toHaveLength(1);
  });

  it('skips checking entirely when build is "off"', async () => {
    await expect(build(viteConfig(fourLayers({ build: 'off' })))).resolves.toBeDefined();
  });

  it('throws from transform in dev so the overlay shows the violation', async () => {
    const { thrown, warn } = await driveHooks(
      { dev: 'overlay', fullScan: false },
      'serve',
      'src/components/BadWidget.ts',
      "import { get } from '@/api/http';",
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(thrown?.message).toMatch(/presentation may not import infrastructure/);
    expect(thrown).toMatchObject({
      plugin: 'vite-plugin-4layers',
      loc: { line: 1, column: 1 },
    });
  });

  it('only warns in dev when dev is "warn"', async () => {
    const { thrown, warn } = await driveHooks(
      { dev: 'warn', fullScan: false },
      'serve',
      'src/components/BadWidget.ts',
      "import { get } from '@/api/http';",
    );
    expect(thrown).toBe(null);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays silent for a legal import', async () => {
    const { thrown, warn } = await driveHooks(
      { dev: 'overlay', fullScan: false },
      'serve',
      'src/components/GoodWidget.ts',
      "import { loadOrders } from '@/stores/orders';",
    );
    expect(thrown).toBe(null);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores node_modules, virtual modules and excluded files', async () => {
    for (const id of [
      'node_modules/axios/index.js',
      'src/components/BadWidget.spec.ts',
      'vite.config.ts',
    ]) {
      const { thrown, warn } = await driveHooks(
        { dev: 'overlay', fullScan: false },
        'serve',
        id,
        "import { get } from '@/api/http';",
      );
      expect(thrown, id).toBe(null);
      expect(warn, id).not.toHaveBeenCalled();
    }
  });

  it('picks up aliases from the resolved vite config', async () => {
    // The fixture config declares no alias of its own for `#api`; Vite's does.
    const plugin = fourLayers({ fullScan: false, config: { aliases: {} } });
    const resolved = {
      root: app,
      command: 'serve',
      resolve: { alias: [{ find: '#api', replacement: path.join(app, 'src', 'api') }] },
    } as unknown as ResolvedConfig;
    const configResolved = plugin.configResolved as (config: ResolvedConfig) => Promise<void>;
    await configResolved.call(plugin as never, resolved);

    const warn = vi.fn();
    const transform = plugin.transform as unknown as (
      this: { warn: typeof warn },
      code: string,
      id: string,
    ) => unknown;

    expect(() =>
      transform.call(
        { warn },
        "import { get } from '#api/http';",
        path.join(app, 'src/components/BadWidget.ts'),
      ),
    ).toThrow(/presentation may not import infrastructure/);
  });
});
