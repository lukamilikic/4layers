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
import type { CheckResult } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'sample');

let result: CheckResult;

beforeAll(async () => {
  result = await check({ root: fixture });
});

describe('formatPretty', () => {
  it('groups violations by file and includes hints', () => {
    const output = formatPretty(result);
    expect(output).toContain('src/components/CartView.vue');
    expect(output).toContain('presentation may not import infrastructure');
    expect(output).toMatch(/->.*application-layer store/);
    expect(output).toContain('5 errors');
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
  it('lists every layer with its file count and allowances', () => {
    const output = formatLayerTable(result);
    expect(output).toMatch(/layer\s+files\s+may import/);
    expect(output).toMatch(/domain\s+2\s+\(nothing\)/);
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
