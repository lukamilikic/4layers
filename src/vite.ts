/**
 * Vite plugin — the Vue-side integration.
 *
 * In dev it checks each module as Vite transforms it, so a forbidden import
 * shows up the moment you save the file (optionally as a full-screen error
 * overlay). In build it runs one whole-project check and fails the build.
 *
 * It runs with `enforce: 'pre'`, which means `.vue` files arrive as raw SFCs
 * and get scanned before `@vitejs/plugin-vue` splits them up.
 */

import path from 'node:path';

import type { Plugin, ResolvedConfig as ViteResolvedConfig } from 'vite';

import { createChecker, type Checker } from './checker.js';
import { loadConfig, resolveConfig } from './config.js';
import { toPosix } from './matcher.js';
import { formatSummary, paint } from './report.js';
import type { FourLayersUserConfig, Violation } from './types.js';
import { shouldScan } from './walk.js';

export interface FourLayersPluginOptions {
  /** Inline config, merged over `4layers.config.*`. */
  config?: FourLayersUserConfig;
  /** Explicit config file path, relative to the Vite root. */
  configPath?: string;
  /**
   * What a violation does during `vite dev`.
   * - `'overlay'` (default): logs it and shows Vite's error overlay.
   * - `'warn'`: logs it only.
   * - `'off'`: no dev-time checking.
   */
  dev?: 'overlay' | 'warn' | 'off';
  /**
   * What a violation does during `vite build`.
   * - `'error'` (default): fails the build.
   * - `'warn'`: logs and continues.
   * - `'off'`: no build-time checking.
   */
  build?: 'error' | 'warn' | 'off';
  /**
   * Check the whole project once at build start, instead of relying on the
   * modules Vite happens to pull into the graph. Defaults to true in build.
   */
  fullScan?: boolean;
  /** Treat warnings like errors. */
  maxWarnings?: number;
}

const PLUGIN_NAME = 'vite-plugin-4layers';

function describe(violation: Violation): string {
  const location = `${violation.file}:${violation.line}:${violation.column}`;
  const hint = violation.hint ? `\n    ${violation.hint}` : '';
  return `${location}\n    ${violation.message} (${violation.rule})${hint}`;
}

/** Extract the string-keyed aliases from a resolved Vite config. */
function viteAliases(config: ViteResolvedConfig): Record<string, string> {
  const aliases: Record<string, string> = {};
  const entries = config.resolve?.alias;
  if (!entries) return aliases;

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (typeof entry.find === 'string' && typeof entry.replacement === 'string') {
        aliases[entry.find] = entry.replacement;
      }
    }
    return aliases;
  }

  for (const [find, replacement] of Object.entries(entries as Record<string, string>)) {
    if (typeof replacement === 'string') aliases[find] = replacement;
  }
  return aliases;
}

export function fourLayers(options: FourLayersPluginOptions = {}): Plugin {
  const devMode = options.dev ?? 'overlay';
  const buildMode = options.build ?? 'error';

  let checker: Checker | null = null;
  let root = process.cwd();
  let isBuild = false;
  // Set once a whole-project scan has reported everything, so per-module
  // transforms do not report the same violations a second time.
  let fullScanDone = false;

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',

    async configResolved(viteConfig) {
      root = viteConfig.root;
      isBuild = viteConfig.command === 'build';

      const loaded = await loadConfig(root, options.configPath);
      const user: FourLayersUserConfig = { ...loaded.user, ...(options.config ?? {}) };
      const config = resolveConfig(
        {
          ...user,
          // Vite's own aliases win over inferred ones but lose to explicit config.
          aliases: { ...viteAliases(viteConfig), ...(user.aliases ?? {}) },
        },
        { root: loaded.configFile ? loaded.root : root, configFile: loaded.configFile },
      );
      checker = createChecker(config);
    },

    async buildStart() {
      const mode = isBuild ? buildMode : devMode;
      if (!checker || mode === 'off') return;
      const fullScan = options.fullScan ?? isBuild;
      if (!fullScan) return;

      const result = checker.checkProject();
      // Builds are one-shot; in dev, edits after startup still need checking.
      fullScanDone = isBuild;
      for (const violation of result.violations) {
        this.warn(describe(violation));
      }

      const overWarnings =
        options.maxWarnings !== undefined && result.warningCount > options.maxWarnings;

      if ((result.errorCount > 0 || overWarnings) && (mode === 'error' || mode === 'overlay')) {
        this.error(
          `4layers: ${result.errorCount} layer violation(s). ` +
            'Run `npx 4layers check` for the full report.',
        );
      }

      if (!isBuild && result.violations.length === 0) {
        // Quiet confirmation in dev, so you know the guard is actually on.
        console.log(`${paint.gray('[4layers]')} ${formatSummary(result)}`);
      }
    },

    transform(code, id) {
      const mode = isBuild ? buildMode : devMode;
      if (!checker || mode === 'off' || fullScanDone) return null;
      if (id.includes('\0') || id.includes('node_modules')) return null;

      const file = id.split('?')[0] as string;
      if (!path.isAbsolute(file)) return null;

      const relative = toPosix(path.relative(checker.config.root, file));
      if (!relative || relative.startsWith('..')) return null;
      if (!shouldScan(relative, checker.config)) return null;

      const violations = checker.checkFile(relative, code);
      if (violations.length === 0) return null;

      const errors = violations.filter((violation) => violation.severity === 'error');
      for (const violation of violations) this.warn(describe(violation));

      if (errors.length > 0 && (mode === 'overlay' || mode === 'error')) {
        const first = errors[0] as Violation;
        const error = new Error(
          `4layers: ${first.message}${first.hint ? `\n\n${first.hint}` : ''}`,
        );
        // Gives Vite's overlay a precise location to highlight.
        Object.assign(error, {
          loc: { file, line: first.line, column: first.column },
          plugin: PLUGIN_NAME,
          id,
        });
        throw error;
      }

      return null;
    },
  };
}

export default fourLayers;
export { fourLayers as fourLayersPlugin };
export type { FourLayersUserConfig } from './types.js';
