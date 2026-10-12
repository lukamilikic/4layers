/**
 * Config loading and normalisation.
 *
 * A project is configured by a `4layers.config.{ts,mts,js,mjs,cjs,json}` file,
 * a `.4layersrc.json`, or a `"4layers"` key in `package.json`. Everything is
 * optional: with no config at all the `classic` preset and the conventional
 * Vue directory layout are used.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_EXCLUDE,
  DEFAULT_EXTENSIONS,
  DEFAULT_INCLUDE,
  DEFAULT_PRESET,
  getPreset,
} from './presets.js';
import type {
  FourLayersUserConfig,
  LayerConfig,
  ResolvedConfig,
  ResolvedLayerConfig,
  RuleId,
  Severity,
} from './types.js';

const CONFIG_FILES = [
  '4layers.config.ts',
  '4layers.config.mts',
  '4layers.config.mjs',
  '4layers.config.js',
  '4layers.config.cjs',
  '4layers.config.json',
  '.4layersrc.json',
  '.4layersrc',
];

const VALID_SEVERITIES: Severity[] = ['error', 'warn', 'off'];

/** Identity helper that gives editors full type checking and completion. */
export function defineConfig(config: FourLayersUserConfig): FourLayersUserConfig {
  return config;
}

export interface LoadedConfig {
  user: FourLayersUserConfig;
  /** Absolute path of the config file, or null when none was found. */
  configFile: string | null;
  /** Directory the config was found in (or the search start). */
  root: string;
}

/** Walk up from `cwd` looking for a config file or a `package.json` key. */
export function findConfigFile(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
        if (pkg['4layers'] || pkg.fourLayers) return pkgPath;
      } catch {
        // An unreadable package.json is not our problem; keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function stripJsonComments(json: string): string {
  return json.replace(/\\"|"(?:\\"|[^"])*"|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, (match, comment) =>
    comment ? ' ' : match,
  );
}

function readJson(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
}

async function importConfigModule(file: string): Promise<FourLayersUserConfig> {
  const url = pathToFileURL(file).href + `?t=${Date.now()}`;
  let module: Record<string, unknown>;
  try {
    module = (await import(url)) as Record<string, unknown>;
  } catch (error) {
    if (/\.m?ts$/.test(file)) {
      throw new Error(
        `Could not load ${path.basename(file)}: ${(error as Error).message}\n` +
          'TypeScript config files need Node 22.6+ (--experimental-strip-types) or Node 23.6+. ' +
          'Rename it to 4layers.config.mjs or 4layers.config.json if you are on an older Node.',
      );
    }
    throw error;
  }
  const candidate = module.default ?? module.config ?? module;
  if (typeof candidate === 'function') {
    return (await (candidate as () => FourLayersUserConfig | Promise<FourLayersUserConfig>)());
  }
  return candidate as FourLayersUserConfig;
}

/** Load the config for `cwd`, or from an explicit file path. */
export async function loadConfig(
  cwd: string = process.cwd(),
  explicitPath?: string,
): Promise<LoadedConfig> {
  const file = explicitPath ? path.resolve(cwd, explicitPath) : findConfigFile(cwd);

  if (!file) {
    return { user: {}, configFile: null, root: path.resolve(cwd) };
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Config file not found: ${file}`);
  }

  const dir = path.dirname(file);
  const base = path.basename(file);

  if (base === 'package.json') {
    const pkg = readJson(file);
    const user = (pkg['4layers'] ?? pkg.fourLayers) as FourLayersUserConfig;
    return { user: user ?? {}, configFile: file, root: dir };
  }

  if (/\.json$/.test(base) || base === '.4layersrc') {
    return { user: readJson(file) as FourLayersUserConfig, configFile: file, root: dir };
  }

  return { user: await importConfigModule(file), configFile: file, root: dir };
}

/**
 * Derive aliases from `tsconfig.json` / `jsconfig.json` paths, so a project
 * that already maps `@/*` to `./src/*` needs no 4layers alias config.
 */
export function inferAliases(root: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const json = readJson(file);
      const compilerOptions = (json.compilerOptions ?? {}) as Record<string, unknown>;
      const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
      const paths = (compilerOptions.paths ?? {}) as Record<string, string[]>;
      for (const [from, targets] of Object.entries(paths)) {
        const target = targets[0];
        if (!target) continue;
        const key = from.replace(/\/\*$/, '');
        const value = path.posix.join(
          baseUrl.replace(/\\/g, '/'),
          target.replace(/\\/g, '/').replace(/\/\*$/, ''),
        );
        aliases[key] = value.replace(/^\.\//, '');
      }
    } catch {
      // Malformed tsconfig: fall back to the defaults below.
    }
  }
  if (Object.keys(aliases).length === 0) {
    return { '@': 'src', '~': 'src' };
  }
  return aliases;
}

function mergeLayer(base: LayerConfig | undefined, override: Partial<LayerConfig>): LayerConfig {
  const files = override.files ?? base?.files;
  if (!files || files.length === 0) {
    throw new Error('Every layer needs at least one "files" glob.');
  }
  return {
    files,
    exclude: override.exclude ?? base?.exclude,
    canImport: override.canImport ?? base?.canImport ?? [],
    description: override.description ?? base?.description,
    packages: override.packages
      ? {
          allow: override.packages.allow ?? base?.packages?.allow,
          deny: override.packages.deny ?? base?.packages?.deny,
        }
      : base?.packages,
  };
}

function assertSeverity(rule: string, value: unknown): Severity {
  if (typeof value !== 'string' || !VALID_SEVERITIES.includes(value as Severity)) {
    throw new Error(
      `Invalid severity "${String(value)}" for rule "${rule}". Use "error", "warn" or "off".`,
    );
  }
  return value as Severity;
}

/** Merge a user config over its preset and fill in every default. */
export function resolveConfig(
  user: FourLayersUserConfig = {},
  context: { root?: string; configFile?: string | null } = {},
): ResolvedConfig {
  // A relative `root` in the config file is relative to the config file.
  const root = path.resolve(context.root ?? process.cwd(), user.root ?? '.');
  const preset = getPreset(user.extends);

  const layers: Record<string, ResolvedLayerConfig> = {};
  const names = new Set([...Object.keys(preset.layers), ...Object.keys(user.layers ?? {})]);

  for (const name of names) {
    const override = user.layers?.[name] ?? {};
    try {
      const merged = mergeLayer(preset.layers[name], override);
      layers[name] = { ...merged, files: merged.files, canImport: merged.canImport ?? [] };
    } catch (error) {
      throw new Error(`Layer "${name}": ${(error as Error).message}`);
    }
  }

  const severity = { ...preset.severity } as Record<RuleId, Severity>;
  for (const [rule, value] of Object.entries(user.severity ?? {})) {
    if (!(rule in severity)) {
      throw new Error(
        `Unknown rule "${rule}" in "severity". Known rules: ${Object.keys(severity).join(', ')}.`,
      );
    }
    severity[rule as RuleId] = assertSeverity(rule, value);
  }

  return {
    root,
    configFile: context.configFile ?? null,
    extends: user.extends ?? DEFAULT_PRESET,
    include: user.include ?? DEFAULT_INCLUDE,
    exclude: user.exclude ?? DEFAULT_EXCLUDE,
    layers,
    layerNames: Object.keys(layers),
    aliases: { ...inferAliases(root), ...(user.aliases ?? {}) },
    extensions: user.extensions ?? DEFAULT_EXTENSIONS,
    allowSelfImports: user.allowSelfImports ?? preset.allowSelfImports,
    typeOnlyImports: user.typeOnlyImports ?? preset.typeOnlyImports,
    severity,
  };
}

/** Convenience: find, load and normalise in one call. */
export async function loadResolvedConfig(
  cwd: string = process.cwd(),
  explicitPath?: string,
): Promise<ResolvedConfig> {
  const loaded = await loadConfig(cwd, explicitPath);
  return resolveConfig(loaded.user, { root: loaded.root, configFile: loaded.configFile });
}
