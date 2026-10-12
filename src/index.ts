/**
 * 4layers — architecture layer checker.
 *
 * Enforces the dependency direction of a layered frontend:
 *
 *   presentation -> application -> domain <- infrastructure
 *
 * Use it from the CLI (`4layers check`), from Vite (`4layers/vite`), or
 * programmatically through `check()` / `createChecker()`.
 */

export { check, createChecker, type Checker, type CheckOptions } from './checker.js';
export {
  defineConfig,
  findConfigFile,
  inferAliases,
  loadConfig,
  loadResolvedConfig,
  resolveConfig,
  type LoadedConfig,
} from './config.js';
export { createLayerIndex, type LayerAssignment, type LayerIndex, type PackageVerdict } from './layers.js';
export { createMatcher, expandPattern, globToRegExp, specificity, toPosix, type Matcher } from './matcher.js';
export {
  DEFAULT_EXCLUDE,
  DEFAULT_EXTENSIONS,
  DEFAULT_INCLUDE,
  DEFAULT_LAYER_FILES,
  DEFAULT_PRESET,
  getPreset,
  IO_PACKAGES,
  presets,
  STATE_PACKAGES,
  UI_PACKAGES,
  type Preset,
} from './presets.js';
export {
  format,
  formatCompact,
  formatDot,
  formatGithub,
  formatJson,
  formatLayerTable,
  formatMermaid,
  formatPretty,
  formatSummary,
  paintLayer,
  type ReportFormat,
} from './report.js';
export { createResolver, parsePackageSpecifier, type Resolver, type ResolverOptions } from './resolver.js';
export {
  collectDirectives,
  isSilenced,
  maskComments,
  maskNonScript,
  scanImports,
  type Directives,
  type ScanResult,
} from './scanner.js';
export { shouldScan, walkProject, type WalkOptions } from './walk.js';
export type {
  CanonicalLayer,
  CheckResult,
  FourLayersUserConfig,
  ImportKind,
  ImportRecord,
  LayerConfig,
  LayerEdge,
  PackagePolicy,
  PresetName,
  ResolvedConfig,
  ResolvedImport,
  ResolvedLayerConfig,
  RuleId,
  Severity,
  SeverityMap,
  Violation,
} from './types.js';
