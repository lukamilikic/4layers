/**
 * Public type surface for 4layers.
 *
 * The checker is layer-name agnostic: the four canonical layers
 * (presentation / application / domain / infrastructure) are just the default
 * preset. Any number of named layers with any allowed-edge matrix works.
 */

/** How loudly a broken rule is reported. */
export type Severity = 'error' | 'warn' | 'off';

/** Canonical layer names shipped with the default presets. */
export type CanonicalLayer =
  | 'presentation'
  | 'application'
  | 'domain'
  | 'infrastructure'
  | 'composition';

/** Built-in rule presets. */
export type PresetName = 'strict' | 'classic' | 'relaxed';

/** Rule identifiers, usable in ignore comments and report filters. */
export type RuleId =
  | 'layer-dependency'
  | 'package-boundary'
  | 'unassigned-file'
  | 'unresolved-import'
  | 'self-import'
  | 'unknown-layer';

/** Syntax that produced an edge. */
export type ImportKind = 'import' | 'export' | 'dynamic' | 'require';

/** A single import statement found in a source file. */
export interface ImportRecord {
  /** The literal module specifier, e.g. `@/stores/cart` or `axios`. */
  specifier: string;
  /** 1-based line of the statement. */
  line: number;
  /** 1-based column of the statement. */
  column: number;
  /** `import type ...`, `export type ...`, or an all-type named clause. */
  typeOnly: boolean;
  kind: ImportKind;
}

/** Result of turning a specifier into something the checker can judge. */
export type ResolvedImport =
  | {
      target: 'internal';
      /** Project-relative, POSIX-separated path of the imported file. */
      file: string;
    }
  | {
      target: 'external';
      /** Bare package name, e.g. `axios` or `@tanstack/vue-query`. */
      packageName: string;
      /** Deep-import subpath, e.g. `dist/esm` for `axios/dist/esm`. */
      subpath: string;
    }
  | {
      target: 'unresolved';
      reason: string;
    }
  | {
      target: 'ignored';
      reason: string;
    };

/** Package allow/deny policy for one layer. */
export interface PackagePolicy {
  /**
   * When set, only packages matching one of these globs may be imported by
   * this layer. Use it to keep the domain layer dependency-free.
   */
  allow?: string[];
  /** Packages matching one of these globs may never be imported. */
  deny?: string[];
}

/** A layer as the user declares it. */
export interface LayerConfig {
  /** Globs (project-relative) of files that belong to this layer. */
  files: string[];
  /** Globs carved back out of `files`. */
  exclude?: string[];
  /**
   * Layer names this layer may import from. Importing its own layer is always
   * allowed unless `allowSelfImports` is false. `'*'` allows every layer.
   */
  canImport?: string[];
  /** External (node_modules) policy for this layer. */
  packages?: PackagePolicy;
  /** Shown by `4layers explain` and in violation messages. */
  description?: string;
}

/** Per-rule severity overrides. */
export type SeverityMap = Partial<Record<RuleId, Severity>>;

/** User-facing config, as written in `4layers.config.*`. */
export interface FourLayersUserConfig {
  /** Project root. Defaults to the directory holding the config file. */
  root?: string;
  /** Preset to build on. Defaults to `classic`. */
  extends?: PresetName;
  /** Files to scan. */
  include?: string[];
  /** Files to skip entirely. */
  exclude?: string[];
  /** Layer definitions, deep-merged over the preset's. */
  layers?: Record<string, Partial<LayerConfig>>;
  /** Import alias map, e.g. `{ '@': 'src' }`. Values are root-relative. */
  aliases?: Record<string, string>;
  /** File extensions tried when resolving extensionless specifiers. */
  extensions?: string[];
  /** Allow a layer to import itself. Default `true`. */
  allowSelfImports?: boolean;
  /**
   * How `import type` edges are treated.
   * - `check` (default): type imports obey the same rules as value imports.
   * - `ignore`: type-only edges are never reported.
   */
  typeOnlyImports?: 'check' | 'ignore';
  /** Per-rule severity overrides, merged over the preset's. */
  severity?: SeverityMap;
}

/** A layer definition after preset merging: `files` and `canImport` are set. */
export type ResolvedLayerConfig = LayerConfig & {
  files: string[];
  canImport: string[];
};

/** Fully normalised config, used internally and exposed on results. */
export interface ResolvedConfig {
  root: string;
  configFile: string | null;
  extends: PresetName;
  include: string[];
  exclude: string[];
  layers: Record<string, ResolvedLayerConfig>;
  layerNames: string[];
  aliases: Record<string, string>;
  extensions: string[];
  allowSelfImports: boolean;
  typeOnlyImports: 'check' | 'ignore';
  severity: Record<RuleId, Severity>;
}

/** One rule break at one source location. */
export interface Violation {
  rule: RuleId;
  severity: 'error' | 'warn';
  message: string;
  /** Project-relative POSIX path. */
  file: string;
  line: number;
  column: number;
  specifier: string;
  fromLayer: string | null;
  toLayer: string | null;
  /** Set for `package-boundary`. */
  packageName?: string;
  typeOnly: boolean;
  /** Short hint on how to fix it. */
  hint?: string;
}

/** An observed edge between two layers, aggregated across the project. */
export interface LayerEdge {
  from: string;
  to: string;
  count: number;
  allowed: boolean;
}

/** Everything a check produced. */
export interface CheckResult {
  violations: Violation[];
  errorCount: number;
  warningCount: number;
  /** Scanned files, keyed by project-relative path, valued by layer or null. */
  files: Record<string, string | null>;
  /** Aggregated layer-to-layer edges, including the illegal ones. */
  edges: LayerEdge[];
  stats: {
    filesScanned: number;
    importsScanned: number;
    filesByLayer: Record<string, number>;
    durationMs: number;
  };
  config: ResolvedConfig;
}
