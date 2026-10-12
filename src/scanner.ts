/**
 * Source scanning: pulls module specifiers and ignore directives out of a file
 * without an AST, so the package stays dependency-free and fast enough to run
 * inside a Vite transform on every save.
 *
 * The scanner masks comments before matching, extracts only `<script>` blocks
 * from `.vue` SFCs, and keeps byte offsets intact so reported line numbers are
 * the real ones.
 */

import type { ImportRecord, RuleId } from './types.js';

/** `// 4layers-disable-next-line [rule]` style escape hatches. */
export interface Directives {
  /** `4layers-disable-file` seen anywhere in the file. */
  disableFile: boolean;
  /**
   * 1-based line number -> the rules silenced on it. `'all'` silences every
   * rule on that line.
   */
  disabledLines: Map<number, Set<string> | 'all'>;
}

export interface ScanResult {
  imports: ImportRecord[];
  directives: Directives;
}

const DIRECTIVE_FILE = /4layers-(?:disable|ignore)-file\b([^\n*]*)/;
const DIRECTIVE_LINE = /4layers-(?:disable|ignore)-next-line\b([^\n*]*)/g;

const RE_IMPORT_FROM =
  /(?:^|[\n;)}])[ \t]*import[ \t\r\n]+(?:(type)[ \t\r\n]+)?([^'"`]*?)from[ \t\r\n]*(['"])([^'"\n]+)\3/g;
const RE_IMPORT_BARE = /(?:^|[\n;)}])[ \t]*import[ \t\r\n]*(['"])([^'"\n]+)\1/g;
const RE_EXPORT_FROM =
  /(?:^|[\n;)}])[ \t]*export[ \t\r\n]+(?:(type)[ \t\r\n]+)?([^'"`]*?)from[ \t\r\n]*(['"])([^'"\n]+)\3/g;
const RE_DYNAMIC = /\bimport[ \t\r\n]*\([ \t\r\n]*(['"])([^'"\n]+)\1/g;
const RE_REQUIRE = /\brequire[ \t\r\n]*\([ \t\r\n]*(['"])([^'"\n]+)\1/g;

/**
 * Replace every character outside `<script>` blocks with a space, keeping
 * newlines (and therefore line numbers) in place.
 */
export function maskNonScript(code: string): string {
  const chars = blankAll(code);
  const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const open = match[1] as string;
    const body = match[2] as string;
    const start = match.index + open.length;
    for (let i = 0; i < body.length; i++) chars[start + i] = body[i] as string;
  }
  return chars.join('');
}

function blankAll(code: string): string[] {
  const chars = new Array<string>(code.length);
  for (let i = 0; i < code.length; i++) {
    const char = code[i] as string;
    chars[i] = char === '\n' || char === '\r' ? char : ' ';
  }
  return chars;
}

/**
 * Blank out line and block comments, preserving offsets. Quote state is reset
 * at every newline, which keeps a regex literal containing a quote from
 * swallowing the rest of the file.
 */
export function maskComments(code: string): string {
  const chars = code.split('');
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    const next = chars[i + 1];

    if (state === 'line') {
      if (char === '\n') state = 'code';
      else chars[i] = ' ';
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i++;
        state = 'code';
      } else if (char !== '\n' && char !== '\r') {
        chars[i] = ' ';
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (char === '\\') {
        i++;
        continue;
      }
      if (state === 'single' && char === "'") state = 'code';
      else if (state === 'double' && char === '"') state = 'code';
      else if (state === 'template' && char === '`') state = 'code';
      else if (char === '\n' && state !== 'template') state = 'code';
      continue;
    }

    if (char === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      state = 'line';
      continue;
    }
    if (char === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i++;
      state = 'block';
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '`') state = 'template';
  }

  return chars.join('');
}

/** Pull the ignore directives out of the raw (un-masked) source. */
export function collectDirectives(code: string): Directives {
  const directives: Directives = { disableFile: false, disabledLines: new Map() };

  const fileMatch = DIRECTIVE_FILE.exec(code);
  if (fileMatch) directives.disableFile = true;

  const offsets = lineOffsets(code);
  DIRECTIVE_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DIRECTIVE_LINE.exec(code)) !== null) {
    const { line } = positionAt(offsets, match.index);
    const rules = parseRuleList(match[1] ?? '');
    directives.disabledLines.set(line + 1, rules);
  }

  return directives;
}

function parseRuleList(raw: string): Set<string> | 'all' {
  const names = raw
    .replace(/[-*/]+$/, '')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (names.length === 0) return 'all';
  return new Set(names);
}

/** True when `rule` is silenced on `line` by a directive. */
export function isSilenced(directives: Directives, line: number, rule: RuleId): boolean {
  if (directives.disableFile) return true;
  const entry = directives.disabledLines.get(line);
  if (!entry) return false;
  return entry === 'all' || entry.has(rule);
}

function lineOffsets(code: string): number[] {
  const offsets = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function positionAt(offsets: number[], index: number): { line: number; column: number } {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] as number) <= index) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: index - (offsets[low] as number) + 1 };
}

/** `{ type A, type B }` is an all-type clause and emits no runtime import. */
function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('}')) return false;
  const inner = trimmed.slice(1, trimmed.lastIndexOf('}'));
  const parts = inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => /^type\s/.test(part));
}

/**
 * Scan a source file for imports and directives.
 *
 * @param code raw file contents
 * @param filename used only to detect `.vue` SFCs
 */
export function scanImports(code: string, filename = ''): ScanResult {
  const directives = collectDirectives(code);
  const scriptOnly = /\.vue$/i.test(filename) ? maskNonScript(code) : code;
  const masked = maskComments(scriptOnly);
  const offsets = lineOffsets(code);
  const imports: ImportRecord[] = [];
  const seen = new Set<string>();

  const push = (
    index: number,
    specifier: string,
    kind: ImportRecord['kind'],
    typeOnly: boolean,
  ) => {
    const key = `${index}:${specifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { line, column } = positionAt(offsets, index);
    imports.push({ specifier, line, column, typeOnly, kind });
  };

  const run = (
    re: RegExp,
    handler: (match: RegExpExecArray) => void,
  ) => {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(masked)) !== null) handler(match);
  };

  run(RE_IMPORT_FROM, (match) => {
    const typeKeyword = Boolean(match[1]);
    const clause = match[2] ?? '';
    const specifier = match[4] as string;
    const index = match.index + leadingOffset(match[0]);
    push(index, specifier, 'import', typeKeyword || isTypeOnlyClause(clause));
  });

  run(RE_EXPORT_FROM, (match) => {
    const typeKeyword = Boolean(match[1]);
    const clause = match[2] ?? '';
    const specifier = match[4] as string;
    const index = match.index + leadingOffset(match[0]);
    push(index, specifier, 'export', typeKeyword || isTypeOnlyClause(clause));
  });

  run(RE_IMPORT_BARE, (match) => {
    const specifier = match[2] as string;
    const index = match.index + leadingOffset(match[0]);
    push(index, specifier, 'import', false);
  });

  run(RE_DYNAMIC, (match) => {
    push(match.index, match[2] as string, 'dynamic', false);
  });

  run(RE_REQUIRE, (match) => {
    push(match.index, match[2] as string, 'require', false);
  });

  imports.sort((a, b) => a.line - b.line || a.column - b.column);
  return { imports, directives };
}

/**
 * Point the reported column at the keyword rather than at the `\n`/`;`/`}`
 * the statement regexes use as a left anchor.
 */
function leadingOffset(matched: string): number {
  const keyword = matched.search(/\b(?:import|export|require)\b/);
  return keyword > 0 ? keyword : 0;
}
