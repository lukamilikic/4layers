/**
 * Reporters. No color dependency: the ANSI codes are inlined and disabled
 * automatically when the output is not a TTY, when `NO_COLOR` is set, or when
 * the format is machine-readable.
 *
 * The human-readable formatters (`formatPretty`, `formatSummary`,
 * `formatLayerTable`) take an optional `Style`, so tests can render them with
 * colors and unicode symbols on or off regardless of the test terminal.
 */

import { defaultStyle, type Paint, type Style } from './style.js';
import type { CheckResult, Violation } from './types.js';

export type ReportFormat = 'pretty' | 'compact' | 'json' | 'github' | 'mermaid' | 'dot';

export type { Style } from './style.js';

const supportsColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

function ansi(open: number, close = 39): Paint {
  return (text: string) => (supportsColor ? `\u001B[${open}m${text}\u001B[${close}m` : text);
}

/**
 * Basic 16-color painters, used by the CLI's own messages, the Vite plugin and
 * the compact format. Their codes are part of the compact output, so they stay
 * as they are.
 */
export const paint = {
  bold: ansi(1, 22),
  dim: ansi(2, 22),
  red: ansi(31),
  green: ansi(32),
  yellow: ansi(33),
  blue: ansi(34),
  magenta: ansi(35),
  cyan: ansi(36),
  gray: ansi(90),
};

/** Colorise a layer name consistently across every report. */
export function paintLayer(layer: string | null, style: Style = defaultStyle()): string {
  if (!layer) return style.color('dim')('unassigned');
  return style.layer(layer);
}

function pluralise(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Violations that share an edge: same source layer, same target, same rule. */
export interface ViolationGroup {
  fromLayer: string | null;
  /** Target layer, package name, or missing layer name; null when there is none. */
  target: string | null;
  rule: Violation['rule'];
  severity: Violation['severity'];
  violations: Violation[];
}

function groupTarget(violation: Violation): string | null {
  if (violation.packageName) return violation.packageName;
  if (violation.toLayer) return violation.toLayer;
  if (violation.rule === 'unknown-layer') return violation.specifier || null;
  return null;
}

/**
 * Group violations by (fromLayer, target, rule), keeping the order in which
 * each group first appears. Within a group, violations are sorted by file,
 * line and column.
 */
export function groupViolations(violations: Violation[]): ViolationGroup[] {
  const groups = new Map<string, ViolationGroup>();
  for (const violation of violations) {
    const target = groupTarget(violation);
    const key = `${violation.fromLayer ?? ''}\u0000${target ?? ''}\u0000${violation.rule}`;
    const group = groups.get(key);
    if (group) {
      group.violations.push(violation);
      if (violation.severity === 'error') group.severity = 'error';
      continue;
    }
    groups.set(key, {
      fromLayer: violation.fromLayer,
      target,
      rule: violation.rule,
      severity: violation.severity,
      violations: [violation],
    });
  }

  for (const group of groups.values()) {
    group.violations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
    );
  }
  return [...groups.values()];
}

/** `presentation → infrastructure`, `presentation → axios`, or '' for none. */
function edgeLabel(group: ViolationGroup, style: Style): string {
  const dim = style.color('dim');
  const arrow = dim(style.symbols.arrow);
  const first = group.violations[0] as Violation;

  if (!group.fromLayer && !group.target) return '';

  const from = group.fromLayer ? style.layer(group.fromLayer) : dim('unassigned');
  if (first.packageName) return `${from} ${arrow} ${first.packageName}`;
  if (first.toLayer) return `${from} ${arrow} ${style.layer(first.toLayer)}`;
  if (group.rule === 'unknown-layer' && group.target) return `${from} ${arrow} ${group.target}`;
  if (group.rule === 'unresolved-import') return `${from} ${arrow} ${dim('unresolved')}`;
  return from;
}

function renderGroup(group: ViolationGroup, style: Style): string[] {
  const severityColor = style.color(group.severity === 'error' ? 'error' : 'warn');
  const symbol = severityColor(
    group.severity === 'error' ? style.symbols.error : style.symbols.warn,
  );
  const label = edgeLabel(group, style);
  const header = label
    ? ` ${symbol} ${label}  ${style.color('dim')(group.rule)}`
    : ` ${symbol} ${group.rule}`;

  const locations = group.violations.map((v) => `${v.file}:${v.line}:${v.column}`);
  const width = Math.max(...locations.map((location) => location.length));

  const lines = [header];
  group.violations.forEach((violation, i) => {
    const location = locations[i] as string;
    const row = `     ${style.underline(location)}`;
    if (!violation.specifier) {
      lines.push(row);
      return;
    }
    const gap = ' '.repeat(width - location.length + 3);
    lines.push(`${row}${gap}${severityColor(`'${violation.specifier}'`)}`);
  });

  // One fix line per distinct hint, so an edge repeated across files is not
  // followed by the same advice over and over.
  const hints = [...new Set(group.violations.map((v) => v.hint).filter(Boolean))] as string[];
  for (const hint of hints) {
    lines.push(`     ${style.color('dim')('fix')}  ${hint}`);
  }
  return lines;
}

/** Human-readable report, grouped by layer edge. */
export function formatPretty(result: CheckResult, style: Style = defaultStyle()): string {
  const blocks = groupViolations(result.violations).map((group) =>
    renderGroup(group, style).join('\n'),
  );
  blocks.push(formatSummary(result, style));
  return blocks.join('\n\n');
}

/** The compact format's summary line, kept exactly as it was before 0.1.1. */
function formatCompactSummary(result: CheckResult): string {
  const { errorCount, warningCount, stats } = result;
  const scanned = paint.gray(
    `· ${pluralise(stats.filesScanned, 'file')}, ${pluralise(stats.importsScanned, 'import')} in ${stats.durationMs}ms`,
  );

  if (errorCount === 0 && warningCount === 0) {
    return `${paint.green('All layers respected.')} ${scanned}`;
  }

  const parts: string[] = [];
  if (errorCount) parts.push(paint.red(pluralise(errorCount, 'error')));
  if (warningCount) parts.push(paint.yellow(pluralise(warningCount, 'warning')));
  return `${paint.bold(parts.join(', '))} ${scanned}`;
}

/** One line per violation, easy to grep and to click in a terminal. */
export function formatCompact(result: CheckResult): string {
  const lines = result.violations.map(
    (violation) =>
      `${violation.file}:${violation.line}:${violation.column}: ${violation.severity}: ${violation.message} (${violation.rule})`,
  );
  lines.push(formatCompactSummary(result));
  return lines.join('\n');
}

/** GitHub Actions workflow commands, so violations annotate the diff. */
export function formatGithub(result: CheckResult): string {
  return result.violations
    .map((violation) => {
      const kind = violation.severity === 'error' ? 'error' : 'warning';
      const message = violation.hint
        ? `${violation.message} ${violation.hint}`
        : violation.message;
      return `::${kind} file=${violation.file},line=${violation.line},col=${violation.column},title=4layers/${violation.rule}::${message}`;
    })
    .join('\n');
}

export function formatJson(result: CheckResult): string {
  return JSON.stringify(
    {
      ok: result.errorCount === 0,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      violations: result.violations,
      edges: result.edges,
      stats: result.stats,
      layers: Object.fromEntries(
        Object.entries(result.config.layers).map(([name, layer]) => [
          name,
          { canImport: layer.canImport, files: layer.files },
        ]),
      ),
    },
    null,
    2,
  );
}

/** Mermaid flowchart of the layers, with illegal edges dashed and labelled. */
export function formatMermaid(result: CheckResult): string {
  const lines = ['flowchart TD'];
  for (const name of result.config.layerNames) {
    const count = result.stats.filesByLayer[name] ?? 0;
    lines.push(`  ${id(name)}["${name}<br/><small>${pluralise(count, 'file')}</small>"]`);
  }

  const declared = new Set<string>();
  const illegalLinks: number[] = [];
  let linkIndex = 0;

  for (const [from, layer] of Object.entries(result.config.layers)) {
    for (const to of layer.canImport) {
      if (to === '*' || !result.config.layers[to]) continue;
      declared.add(`${from}->${to}`);
      const observed = result.edges.find((edge) => edge.from === from && edge.to === to);
      const label = observed ? ` |${observed.count}|` : '';
      lines.push(`  ${id(from)} -->${label} ${id(to)}`);
      linkIndex++;
    }
  }

  for (const edge of result.edges) {
    if (edge.allowed || declared.has(`${edge.from}->${edge.to}`)) continue;
    lines.push(`  ${id(edge.from)} -. "${edge.count} illegal" .-> ${id(edge.to)}`);
    illegalLinks.push(linkIndex);
    linkIndex++;
  }

  // Style the offending links rather than their nodes: a legal layer should
  // not turn red just because something imports it illegally.
  for (const index of illegalLinks) {
    lines.push(`  linkStyle ${index} stroke:#e5484d,stroke-width:2px,color:#e5484d;`);
  }
  return lines.join('\n');
}

/** Graphviz DOT, for people who already render architecture diagrams that way. */
export function formatDot(result: CheckResult): string {
  const lines = ['digraph layers {', '  rankdir=TB;', '  node [shape=box, style=rounded];'];
  for (const name of result.config.layerNames) {
    const count = result.stats.filesByLayer[name] ?? 0;
    lines.push(`  ${id(name)} [label="${name}\\n${pluralise(count, 'file')}"];`);
  }
  for (const [from, layer] of Object.entries(result.config.layers)) {
    for (const to of layer.canImport) {
      if (to === '*' || !result.config.layers[to]) continue;
      lines.push(`  ${id(from)} -> ${id(to)};`);
    }
  }
  for (const edge of result.edges) {
    if (edge.allowed) continue;
    lines.push(
      `  ${id(edge.from)} -> ${id(edge.to)} [style=dashed, color=red, label="${edge.count}"];`,
    );
  }
  lines.push('}');
  return lines.join('\n');
}

function id(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

/** The trailing summary line of the pretty report. */
export function formatSummary(result: CheckResult, style: Style = defaultStyle()): string {
  const { errorCount, warningCount, stats } = result;
  const dim = style.color('dim');
  const scanned = [
    pluralise(stats.filesScanned, 'file'),
    pluralise(stats.importsScanned, 'import'),
    `${stats.durationMs}ms`,
  ].join(' · ');

  if (errorCount === 0 && warningCount === 0) {
    return ` ${style.color('ok')(style.symbols.ok)} All layers respected ${dim(`· ${scanned}`)}`;
  }

  const symbol =
    errorCount > 0
      ? style.color('error')(style.symbols.error)
      : style.color('warn')(style.symbols.warn);
  const errors = pluralise(errorCount, 'error');
  const warnings = pluralise(warningCount, 'warning');
  return [
    ` ${symbol} ${errorCount > 0 ? style.color('error')(errors) : dim(errors)}`,
    warningCount > 0 ? style.color('warn')(warnings) : dim(warnings),
    dim(scanned),
  ].join(dim(' · '));
}

/** Width of the SHARE bar in the `--stats` table. */
export const BAR_CELLS = 16;

/**
 * Filled cells for one bar, scaled to the largest value. Rounded up, so any
 * non-zero value shows at least one cell.
 */
export function barCells(value: number, max: number, cells: number = BAR_CELLS): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(cells, Math.ceil((value / max) * cells));
}

/** The per-layer table, printed by `4layers check --stats`. */
export function formatLayerTable(result: CheckResult, style: Style = defaultStyle()): string {
  const dim = style.color('dim');
  const importsByLayer = result.stats.importsByLayer ?? {};
  const violationsByLayer: Record<string, number> = {};
  for (const violation of result.violations) {
    if (!violation.fromLayer) continue;
    violationsByLayer[violation.fromLayer] = (violationsByLayer[violation.fromLayer] ?? 0) + 1;
  }

  const rows = result.config.layerNames.map((name) => ({
    name,
    files: result.stats.filesByLayer[name] ?? 0,
    imports: importsByLayer[name] ?? 0,
    violations: violationsByLayer[name] ?? 0,
  }));
  const maxImports = Math.max(0, ...rows.map((row) => row.imports));

  const nameWidth = Math.max('LAYER'.length, ...rows.map((row) => row.name.length));
  const filesWidth = Math.max('FILES'.length, ...rows.map((row) => String(row.files).length));
  const importsWidth = Math.max('IMPORTS'.length, ...rows.map((row) => String(row.imports).length));

  const headerCells = [
    'LAYER'.padEnd(nameWidth),
    'FILES'.padStart(filesWidth),
    'IMPORTS'.padStart(importsWidth),
    'SHARE'.padEnd(BAR_CELLS),
    'VIOLATIONS',
  ];
  const header = headerCells.join('  ');
  const lines = [` ${dim(header)}`, ` ${dim(style.symbols.rule.repeat(header.length))}`];

  for (const row of rows) {
    const filled = barCells(row.imports, maxImports);
    const bar =
      style.layer(row.name, style.symbols.barFull.repeat(filled)) +
      dim(style.symbols.barEmpty.repeat(BAR_CELLS - filled));
    const violations = String(row.violations);
    lines.push(
      ' ' +
        [
          style.layer(row.name, row.name.padEnd(nameWidth)),
          String(row.files).padStart(filesWidth),
          String(row.imports).padStart(importsWidth),
          bar,
          row.violations > 0 ? style.color('error')(violations) : dim(violations),
        ].join('  '),
    );
  }

  const unassigned = Object.values(result.files).filter((layer) => layer === null).length;
  if (unassigned > 0) lines.push(` ${dim(`${pluralise(unassigned, 'file')} in no layer`)}`);
  return lines.join('\n');
}

export function format(result: CheckResult, formatName: ReportFormat): string {
  switch (formatName) {
    case 'json':
      return formatJson(result);
    case 'github':
      return formatGithub(result);
    case 'compact':
      return formatCompact(result);
    case 'mermaid':
      return formatMermaid(result);
    case 'dot':
      return formatDot(result);
    case 'pretty':
    default:
      return formatPretty(result);
  }
}
