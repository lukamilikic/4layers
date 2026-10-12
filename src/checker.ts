/**
 * The checker: walks the project, scans imports, and judges every edge against
 * the layer rules.
 *
 * `checkFile` is the single-file entry point the Vite plugin uses on every
 * transform; `check` is the whole-project entry point the CLI uses.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, resolveConfig } from './config.js';
import { createLayerIndex, type LayerIndex } from './layers.js';
import { toPosix } from './matcher.js';
import { createResolver, type Resolver } from './resolver.js';
import { isSilenced, scanImports } from './scanner.js';
import type {
  CheckResult,
  FourLayersUserConfig,
  LayerEdge,
  ResolvedConfig,
  RuleId,
  Severity,
  Violation,
} from './types.js';
import { walkProject } from './walk.js';

export interface Checker {
  config: ResolvedConfig;
  index: LayerIndex;
  resolver: Resolver;
  /** Which layer owns a file, and which glob decided it. */
  explain(file: string): {
    file: string;
    layer: string | null;
    pattern: string | null;
    canImport: string[];
    description?: string;
  };
  /** Check one file's source. `file` may be absolute or project-relative. */
  checkFile(file: string, code: string): Violation[];
  /** Check a set of project-relative files, reading them from disk. */
  checkFiles(files: string[]): CheckResult;
  /** Walk the project and check everything `include` matches. */
  checkProject(): CheckResult;
}

export interface CheckOptions {
  /** Project root. Defaults to the config file's directory or `cwd`. */
  root?: string;
  /** Explicit config file path. */
  configPath?: string;
  /** Inline config, merged over the file-based one. */
  config?: FourLayersUserConfig;
  /** Restrict the run to these files (absolute or project-relative). */
  files?: string[];
}

interface FileAnalysis {
  fromLayer: string | null;
  violations: Violation[];
  /** Cross-layer edges leaving this file, for the graph report. */
  edges: Array<{ to: string; allowed: boolean }>;
  importCount: number;
}

/** Load config and check the whole project (or `options.files`). */
export async function check(options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = options.root ?? process.cwd();
  const loaded = await loadConfig(cwd, options.configPath);
  const merged: FourLayersUserConfig = { ...loaded.user, ...(options.config ?? {}) };
  const config = resolveConfig(merged, {
    root: options.root ?? loaded.root,
    configFile: loaded.configFile,
  });
  const checker = createChecker(config);
  return options.files?.length ? checker.checkFiles(options.files) : checker.checkProject();
}

export function createChecker(config: ResolvedConfig): Checker {
  const index = createLayerIndex(config);
  const resolver = createResolver({
    root: config.root,
    aliases: config.aliases,
    extensions: config.extensions,
  });

  const severityOf = (rule: RuleId): Severity => config.severity[rule] ?? 'off';

  const relativise = (file: string): string => {
    const absolute = path.isAbsolute(file) ? file : path.resolve(config.root, file);
    return toPosix(path.relative(config.root, absolute));
  };

  function configViolations(): Violation[] {
    const severity = severityOf('unknown-layer');
    if (severity === 'off') return [];
    return index.unknownReferences().map(({ layer, references }) => ({
      rule: 'unknown-layer' as const,
      severity,
      message: `Layer "${layer}" lists "${references}" in canImport, but no such layer is defined.`,
      file: config.configFile ? relativise(config.configFile) : '4layers.config',
      line: 1,
      column: 1,
      specifier: references,
      fromLayer: layer,
      toLayer: null,
      typeOnly: false,
      hint: `Defined layers: ${config.layerNames.join(', ')}.`,
    }));
  }

  /**
   * Single pass over one file: assigns its layer, judges every import, and
   * records the cross-layer edges the graph report needs.
   */
  function analyse(relative: string, code: string): FileAnalysis {
    const violations: Violation[] = [];
    const edges: Array<{ to: string; allowed: boolean }> = [];
    const { layer: fromLayer } = index.layerOf(relative);
    const { imports, directives } = scanImports(code, relative);

    const report = (violation: Omit<Violation, 'severity'> & { severity?: Severity }): void => {
      const severity = violation.severity ?? severityOf(violation.rule);
      if (severity === 'off') return;
      if (isSilenced(directives, violation.line, violation.rule)) return;
      violations.push({ ...violation, severity });
    };

    if (!fromLayer) {
      report({
        rule: 'unassigned-file',
        message: `${relative} does not belong to any layer.`,
        file: relative,
        line: 1,
        column: 1,
        specifier: '',
        fromLayer: null,
        toLayer: null,
        typeOnly: false,
        hint: `Add a glob for it to one of: ${config.layerNames.join(', ')}.`,
      });
      return { fromLayer: null, violations, edges, importCount: imports.length };
    }

    for (const record of imports) {
      if (record.typeOnly && config.typeOnlyImports === 'ignore') continue;
      const resolved = resolver(record.specifier, relative);

      if (resolved.target === 'ignored') continue;

      if (resolved.target === 'unresolved') {
        report({
          rule: 'unresolved-import',
          message: `Cannot resolve "${record.specifier}" (${resolved.reason}).`,
          file: relative,
          line: record.line,
          column: record.column,
          specifier: record.specifier,
          fromLayer,
          toLayer: null,
          typeOnly: record.typeOnly,
          hint: 'Check the path, or add the alias to `aliases` in your 4layers config.',
        });
        continue;
      }

      if (resolved.target === 'external') {
        const full = resolved.subpath
          ? `${resolved.packageName}/${resolved.subpath}`
          : resolved.packageName;
        const verdict = index.checkPackage(fromLayer, resolved.packageName, full);
        if (verdict.allowed) continue;
        report({
          rule: 'package-boundary',
          message: `The ${fromLayer} layer may not import "${full}".`,
          file: relative,
          line: record.line,
          column: record.column,
          specifier: record.specifier,
          fromLayer,
          toLayer: null,
          packageName: resolved.packageName,
          typeOnly: record.typeOnly,
          hint: packageHint(fromLayer, resolved.packageName, verdict.reason),
        });
        continue;
      }

      const toLayer = index.layerOf(resolved.file).layer;
      if (!toLayer) continue;

      if (toLayer !== fromLayer) {
        edges.push({ to: toLayer, allowed: index.canImport(fromLayer, toLayer) });
      }

      if (toLayer === fromLayer) {
        if (config.allowSelfImports) continue;
        report({
          rule: 'self-import',
          message: `The ${fromLayer} layer is configured not to import itself.`,
          file: relative,
          line: record.line,
          column: record.column,
          specifier: record.specifier,
          fromLayer,
          toLayer,
          typeOnly: record.typeOnly,
        });
        continue;
      }

      if (index.canImport(fromLayer, toLayer)) continue;

      report({
        rule: 'layer-dependency',
        message: `${fromLayer} may not import ${toLayer} ("${record.specifier}" resolves to ${resolved.file}).`,
        file: relative,
        line: record.line,
        column: record.column,
        specifier: record.specifier,
        fromLayer,
        toLayer,
        typeOnly: record.typeOnly,
        hint: layerHint(config, fromLayer, toLayer),
      });
    }

    return { fromLayer, violations, edges, importCount: imports.length };
  }

  function checkFile(file: string, code: string): Violation[] {
    return analyse(relativise(file), code).violations;
  }

  function collect(files: string[]): CheckResult {
    const started = Date.now();
    const violations: Violation[] = [...configViolations()];
    const fileLayers: Record<string, string | null> = {};
    const edgeCounts = new Map<string, LayerEdge>();
    const filesByLayer: Record<string, number> = {};
    let importsScanned = 0;

    for (const name of config.layerNames) filesByLayer[name] = 0;

    for (const file of files) {
      const relative = relativise(file);
      const absolute = path.resolve(config.root, relative);
      let code: string;
      try {
        code = fs.readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }

      const analysis = analyse(relative, code);
      const fromLayer = analysis.fromLayer;
      fileLayers[relative] = fromLayer;
      if (fromLayer) filesByLayer[fromLayer] = (filesByLayer[fromLayer] ?? 0) + 1;
      importsScanned += analysis.importCount;
      violations.push(...analysis.violations);

      if (!fromLayer) continue;
      for (const edge of analysis.edges) {
        const key = `${fromLayer}->${edge.to}`;
        const existing = edgeCounts.get(key);
        if (existing) existing.count++;
        else edgeCounts.set(key, { from: fromLayer, to: edge.to, count: 1, allowed: edge.allowed });
      }
    }

    violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
    );

    return {
      violations,
      errorCount: violations.filter((v) => v.severity === 'error').length,
      warningCount: violations.filter((v) => v.severity === 'warn').length,
      files: fileLayers,
      edges: [...edgeCounts.values()].sort(
        (a, b) => b.count - a.count || a.from.localeCompare(b.from),
      ),
      stats: {
        filesScanned: Object.keys(fileLayers).length,
        importsScanned,
        filesByLayer,
        durationMs: Date.now() - started,
      },
      config,
    };
  }

  return {
    config,
    index,
    resolver,
    explain(file: string) {
      const relative = relativise(file);
      const assignment = index.layerOf(relative);
      const layer = assignment.layer ? config.layers[assignment.layer] : undefined;
      return {
        file: relative,
        layer: assignment.layer,
        pattern: assignment.pattern,
        canImport: layer?.canImport ?? [],
        description: layer?.description,
      };
    },
    checkFile,
    checkFiles: (files: string[]) => collect(files),
    checkProject: () =>
      collect(
        walkProject({
          root: config.root,
          include: config.include,
          exclude: config.exclude,
        }),
      ),
  };
}

function layerHint(config: ResolvedConfig, from: string, to: string): string {
  const allowed = config.layers[from]?.canImport ?? [];
  const allowedText = allowed.length
    ? `${from} may import: ${allowed.join(', ')}.`
    : `${from} may not import any other layer.`;

  if (from === 'presentation' && to === 'infrastructure') {
    return `${allowedText} Put the call in an application-layer store or composable and let the component consume that.`;
  }
  if (from === 'domain') {
    return `${allowedText} Invert the dependency: declare a port (interface) in the domain and implement it in ${to}.`;
  }
  if (from === 'infrastructure' && (to === 'application' || to === 'presentation')) {
    return `${allowedText} Infrastructure should expose data and let ${to} call it, not the other way round.`;
  }
  return allowedText;
}

function packageHint(
  layer: string,
  packageName: string,
  reason: 'deny-list' | 'not-in-allow-list' | 'allow-list' | 'no-policy',
): string {
  if (reason === 'not-in-allow-list') {
    return `The ${layer} layer has an allow-list of packages. Add "${packageName}" to layers.${layer}.packages.allow if it really belongs there.`;
  }
  if (layer === 'domain') {
    return `Keep the domain framework-agnostic: wrap "${packageName}" in an infrastructure adapter and depend on a domain port instead.`;
  }
  if (layer === 'presentation') {
    return `Move "${packageName}" behind the application layer so the component only talks to state and use cases.`;
  }
  if (layer === 'infrastructure') {
    return `"${packageName}" belongs to the UI or state layers; infrastructure should not import it.`;
  }
  return `Remove the "${packageName}" import from the ${layer} layer, or relax layers.${layer}.packages.`;
}
