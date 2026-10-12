/**
 * Reporters. No color dependency: the ANSI codes are inlined and disabled
 * automatically when the output is not a TTY, when `NO_COLOR` is set, or when
 * the format is machine-readable.
 */

import type { CheckResult, Violation } from './types.js';

export type ReportFormat = 'pretty' | 'compact' | 'json' | 'github' | 'mermaid' | 'dot';

const supportsColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout.isTTY);

type Paint = (text: string) => string;

function ansi(open: number, close = 39): Paint {
  return (text: string) => (supportsColor ? `\u001B[${open}m${text}\u001B[${close}m` : text);
}

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

const LAYER_COLORS: Record<string, Paint> = {
  presentation: paint.magenta,
  application: paint.blue,
  domain: paint.green,
  infrastructure: paint.yellow,
};

/** Colorise a layer name consistently across every report. */
export function paintLayer(layer: string | null): string {
  if (!layer) return paint.gray('unassigned');
  return (LAYER_COLORS[layer] ?? paint.cyan)(layer);
}

function pluralise(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Human-readable report, grouped by file. */
export function formatPretty(result: CheckResult): string {
  const lines: string[] = [];
  const byFile = new Map<string, Violation[]>();
  for (const violation of result.violations) {
    const list = byFile.get(violation.file);
    if (list) list.push(violation);
    else byFile.set(violation.file, [violation]);
  }

  for (const [file, violations] of byFile) {
    const layer = violations[0]?.fromLayer ?? null;
    lines.push(`${paint.bold(file)} ${paint.gray(`[${layer ?? 'unassigned'}]`)}`);
    for (const violation of violations) {
      const badge =
        violation.severity === 'error' ? paint.red('error') : paint.yellow('warn ');
      const position = paint.gray(`${violation.line}:${violation.column}`);
      lines.push(`  ${position}  ${badge}  ${violation.message}  ${paint.gray(violation.rule)}`);
      if (violation.hint) lines.push(`         ${paint.gray('-> ' + violation.hint)}`);
    }
    lines.push('');
  }

  lines.push(formatSummary(result));
  return lines.join('\n');
}

/** One line per violation, easy to grep and to click in a terminal. */
export function formatCompact(result: CheckResult): string {
  const lines = result.violations.map(
    (violation) =>
      `${violation.file}:${violation.line}:${violation.column}: ${violation.severity}: ${violation.message} (${violation.rule})`,
  );
  lines.push(formatSummary(result));
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

/** The trailing summary line shared by the text reporters. */
export function formatSummary(result: CheckResult): string {
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

/** A compact per-layer table, printed by `4layers check --stats`. */
export function formatLayerTable(result: CheckResult): string {
  const rows = result.config.layerNames.map((name) => {
    const layer = result.config.layers[name]!;
    const count = result.stats.filesByLayer[name] ?? 0;
    const allowed = layer.canImport.length ? layer.canImport.join(', ') : '(nothing)';
    return [name, String(count), allowed];
  });
  const headers = ['layer', 'files', 'may import'];
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] as string).length)),
  );
  const line = (cells: string[], painter: Paint = (text) => text): string =>
    cells
      .map((cell, i) => painter(i === cells.length - 1 ? cell : cell.padEnd(widths[i] as number)))
      .join('  ');

  const unassigned = Object.values(result.files).filter((layer) => layer === null).length;
  const out = [line(headers, paint.bold), ...rows.map((row) => line(row))];
  if (unassigned > 0) out.push(paint.gray(`${pluralise(unassigned, 'file')} in no layer`));
  return out.join('\n');
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
