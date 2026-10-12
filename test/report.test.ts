import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { check } from '../src/checker.js';
import {
  format,
  formatCompact,
  formatDot,
  formatGithub,
  formatJson,
  formatLayerTable,
  formatMermaid,
  formatPretty,
} from '../src/report.js';
import { PLAIN_STYLE } from '../src/style.js';
import type { CheckResult } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sample');

let result: CheckResult;

beforeAll(async () => {
  result = await check({ root: fixture });
});

describe('formatPretty', () => {
  it('groups violations by layer edge and includes fix hints', () => {
    const output = formatPretty(result, PLAIN_STYLE);
    expect(output).toContain(' x presentation -> infrastructure  layer-dependency');
    expect(output).toContain("src/components/CartView.vue:13:1   '@/api/cart'");
    expect(output).toMatch(/ {5}fix {2}.*application-layer store/);
    expect(output).toContain(' x 5 errors · 0 warnings');
  });
});

describe('formatCompact', () => {
  it('writes one grep-friendly line per violation', () => {
    const lines = formatCompact(result).split('\n');
    expect(lines[0]).toMatch(
      /^src\/api\/cart\.ts:\d+:\d+: error: infrastructure may not import application/,
    );
  });
});

describe('formatGithub', () => {
  it('emits workflow commands with file, line and title', () => {
    const output = formatGithub(result);
    expect(output).toMatch(
      /^::error file=src\/api\/cart\.ts,line=\d+,col=\d+,title=4layers\/layer-dependency::/m,
    );
  });
});

describe('formatJson', () => {
  it('is parseable and carries the machine-readable payload', () => {
    const payload = JSON.parse(formatJson(result)) as {
      ok: boolean;
      errorCount: number;
      violations: unknown[];
      layers: Record<string, { canImport: string[] }>;
    };
    expect(payload.ok).toBe(false);
    expect(payload.errorCount).toBe(5);
    expect(payload.violations).toHaveLength(5);
    expect(payload.layers.domain?.canImport).toEqual([]);
  });
});

describe('formatMermaid', () => {
  it('draws the declared edges and dashes the illegal ones', () => {
    const output = formatMermaid(result);
    expect(output.startsWith('flowchart TD')).toBe(true);
    expect(output).toContain('presentation --> |1| application');
    expect(output).toMatch(/presentation -\. "1 illegal" \.-> infrastructure/);
    expect(output).toContain('linkStyle ');
  });
});

describe('formatDot', () => {
  it('produces a digraph with red illegal edges', () => {
    const output = formatDot(result);
    expect(output.startsWith('digraph layers {')).toBe(true);
    expect(output).toContain('color=red');
  });
});

describe('formatLayerTable', () => {
  it('lists every layer with files, imports, share and violations', () => {
    const output = formatLayerTable(result, PLAIN_STYLE);
    expect(output).toMatch(/^ LAYER +FILES {2}IMPORTS {2}SHARE +VIOLATIONS$/m);
    expect(output).toMatch(/^ domain +2 +\d+ {2}[#.]{16} {2}2$/m);
    expect(output).toContain('1 file in no layer');
  });
});

describe('format', () => {
  it('dispatches on the format name and falls back to pretty', () => {
    expect(format(result, 'json')).toBe(formatJson(result));
    expect(format(result, 'github')).toBe(formatGithub(result));
    expect(format(result, 'mermaid')).toBe(formatMermaid(result));
    expect(format(result, 'dot')).toBe(formatDot(result));
    expect(format(result, 'compact')).toBe(formatCompact(result));
    expect(format(result, 'pretty')).toBe(formatPretty(result));
  });
});
