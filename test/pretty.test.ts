import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { check } from '../src/checker.js';
import {
  BAR_CELLS,
  barCells,
  formatCompact,
  formatGithub,
  formatJson,
  formatLayerTable,
  formatPretty,
  formatSummary,
  groupViolations,
} from '../src/report.js';
import { createStyle, detectStyle, isUtf8Locale, PLAIN_STYLE } from '../src/style.js';
import type { CheckResult, Violation } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const golden = (name: string) => fs.readFileSync(path.join(fixtures, 'golden', name), 'utf8');

const UNICODE_TRUECOLOR = createStyle({ color: true, truecolor: true, unicode: true });
const UNICODE_16 = createStyle({ color: true, truecolor: false, unicode: true });
const ESC = '\u001B[';

function violation(overrides: Partial<Violation>): Violation {
  return {
    rule: 'layer-dependency',
    severity: 'error',
    message: 'message',
    file: 'src/a.ts',
    line: 1,
    column: 1,
    specifier: '@/x',
    fromLayer: 'presentation',
    toLayer: 'infrastructure',
    typeOnly: false,
    ...overrides,
  };
}

async function deterministicCheck(fixture: string, extra = {}): Promise<CheckResult> {
  const result = await check({ root: path.join(fixtures, fixture), config: extra });
  result.stats.durationMs = 0;
  return result;
}

let visuals: CheckResult;
let sample: CheckResult;

beforeAll(async () => {
  visuals = await deterministicCheck('cli-visuals');
  sample = await deterministicCheck('sample');
});

describe('groupViolations', () => {
  it('groups by (fromLayer, target, rule) in order of first appearance', () => {
    const groups = groupViolations([
      violation({ file: 'src/b.ts' }),
      violation({ toLayer: null, packageName: 'axios', rule: 'package-boundary' }),
      violation({ file: 'src/a.ts' }),
      violation({ fromLayer: 'domain' }),
    ]);
    expect(groups.map((g) => [g.fromLayer, g.target, g.rule, g.violations.length])).toEqual([
      ['presentation', 'infrastructure', 'layer-dependency', 2],
      ['presentation', 'axios', 'package-boundary', 1],
      ['domain', 'infrastructure', 'layer-dependency', 1],
    ]);
  });

  it('sorts violations inside a group by file, line and column', () => {
    const [group] = groupViolations([
      violation({ file: 'src/b.ts', line: 1 }),
      violation({ file: 'src/a.ts', line: 9, column: 2 }),
      violation({ file: 'src/a.ts', line: 9, column: 1 }),
      violation({ file: 'src/a.ts', line: 3 }),
    ]);
    expect(group?.violations.map((v) => `${v.file}:${v.line}:${v.column}`)).toEqual([
      'src/a.ts:3:1',
      'src/a.ts:9:1',
      'src/a.ts:9:2',
      'src/b.ts:1:1',
    ]);
  });

  it('keeps the same edge with different rules apart', () => {
    const groups = groupViolations([
      violation({}),
      violation({ rule: 'self-import', toLayer: 'infrastructure' }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('formatPretty: target layout', () => {
  it('renders the fixture exactly, with plain symbols', () => {
    expect(formatPretty(visuals, PLAIN_STYLE)).toBe(
      [
        ' x infrastructure -> application  layer-dependency',
        "     src/api/cart.ts:4:1   '@/stores/cart'",
        '     fix  infrastructure may import: domain. Infrastructure should expose data and let application call it, not the other way round.',
        '',
        ' x presentation -> infrastructure  layer-dependency',
        "     src/components/CartView.vue:13:1   '@/api/cart'",
        '     fix  presentation may import: application, domain. Put the call in an application-layer store or composable and let the component consume that.',
        '',
        ' x presentation -> axios  package-boundary',
        "     src/components/CartView.vue:15:1   'axios'",
        '     fix  Move "axios" behind the application layer so the component only talks to state and use cases.',
        '',
        ' x 3 errors · 0 warnings · 7 files · 13 imports · 0ms',
      ].join('\n'),
    );
  });

  it('aligns the specifier column inside a group', () => {
    const output = formatPretty(
      { ...visuals, violations: [
        violation({ file: 'src/components/LongName.vue', line: 120, specifier: '@/a' }),
        violation({ file: 'src/c.vue', specifier: '@/b' }),
      ] },
      PLAIN_STYLE,
    );
    const rows = output.split('\n').filter((line) => line.includes("'@/"));
    const columns = rows.map((row) => row.indexOf("'"));
    expect(new Set(columns).size).toBe(1);
  });

  it('prints one fix line per distinct hint', () => {
    const output = formatPretty(
      { ...visuals, violations: [
        violation({ file: 'src/a.ts', hint: 'same' }),
        violation({ file: 'src/b.ts', hint: 'same' }),
        violation({ file: 'src/c.ts', hint: 'other' }),
      ] },
      PLAIN_STYLE,
    );
    expect(output.match(/fix {2}same/g)).toHaveLength(1);
    expect(output).toContain('fix  other');
  });

  it('omits the fix line when there is no hint (--no-hints)', () => {
    const withoutHints = {
      ...visuals,
      violations: visuals.violations.map(({ hint: _hint, ...rest }) => rest),
    };
    const output = formatPretty(withoutHints, PLAIN_STYLE);
    expect(output).not.toContain('fix');
    expect(output).toContain("src/api/cart.ts:4:1   '@/stores/cart'");
  });

  it('uses the warning symbol and color for warnings', async () => {
    const relaxed = await deterministicCheck('cli-visuals', { extends: 'relaxed' });
    expect(formatPretty(relaxed, PLAIN_STYLE)).toContain(' ! presentation -> infrastructure');
    expect(formatSummary(relaxed, PLAIN_STYLE)).toBe(
      ' ! 0 errors · 3 warnings · 7 files · 13 imports · 0ms',
    );
    const colored = formatPretty(relaxed, UNICODE_TRUECOLOR);
    expect(colored).toContain('⚠');
    expect(colored).toContain(`${ESC}38;2;227;179;65m`);
  });

  it('prints only the summary on a clean run', () => {
    const clean = { ...visuals, violations: [], errorCount: 0, warningCount: 0 };
    expect(formatPretty(clean, PLAIN_STYLE)).toBe(
      ' ok All layers respected · 7 files · 13 imports · 0ms',
    );
    expect(formatPretty(clean, UNICODE_16)).toContain('✔');
  });
});

describe('formatPretty: violations with null layers', () => {
  const render = (violations: Violation[]) =>
    formatPretty({ ...visuals, violations }, PLAIN_STYLE);

  it('labels unassigned files by rule and lists them without a specifier', () => {
    const output = render([
      violation({ rule: 'unassigned-file', fromLayer: null, toLayer: null, specifier: '', file: 'src/foo.ts', severity: 'warn' }),
      violation({ rule: 'unassigned-file', fromLayer: null, toLayer: null, specifier: '', file: 'src/bar.ts', severity: 'warn' }),
    ]);
    expect(output).toContain(' ! unassigned-file\n     src/bar.ts:1:1\n     src/foo.ts:1:1');
  });

  it('labels unresolved imports with an unresolved target', () => {
    const output = render([violation({ rule: 'unresolved-import', toLayer: null, specifier: '@/nope' })]);
    expect(output).toContain(' x presentation -> unresolved  unresolved-import');
    expect(output).toContain("'@/nope'");
  });

  it('labels unknown-layer with the missing layer name', () => {
    const output = render([
      violation({ rule: 'unknown-layer', toLayer: null, specifier: 'nope', file: '4layers.config.mjs' }),
    ]);
    expect(output).toContain(' x presentation -> nope  unknown-layer');
  });

  it('renders self-import as a layer pointing at itself', () => {
    const output = render([violation({ rule: 'self-import', toLayer: 'presentation' })]);
    expect(output).toContain(' x presentation -> presentation  self-import');
  });

  it('shows "unassigned" when only the source layer is missing', () => {
    const output = render([violation({ fromLayer: null, toLayer: 'domain' })]);
    expect(output).toContain(' x unassigned -> domain  layer-dependency');
  });
});

describe('colors and symbols', () => {
  it('uses truecolor codes when COLORTERM allows it', () => {
    const output = formatPretty(visuals, UNICODE_TRUECOLOR);
    expect(output).toContain(`${ESC}38;2;255;123;114m✖`);
    expect(output).toContain(`${ESC}38;2;121;192;255mpresentation`);
    expect(output).toContain('→');
  });

  it('falls back to the closest 16-color codes', () => {
    const output = formatPretty(visuals, UNICODE_16);
    expect(output).toContain(`${ESC}91m✖`);
    expect(output).toContain(`${ESC}94mpresentation`);
    expect(output).toContain(`${ESC}33minfrastructure`);
    expect(output).not.toContain('38;2;');
  });

  it('underlines every path:line:col', () => {
    const output = formatPretty(visuals, UNICODE_16);
    expect(output).toContain(`${ESC}4msrc/api/cart.ts:4:1${ESC}24m`);
  });

  it('emits no escape codes and only ASCII in plain mode', () => {
    const output = formatPretty(visuals, PLAIN_STYLE) + formatLayerTable(visuals, PLAIN_STYLE);
    expect(output).not.toContain('\u001B');
    expect(/^[\x20-\x7E\n·]*$/.test(output)).toBe(true);
  });

  it('paints unknown layers cyan', () => {
    expect(UNICODE_TRUECOLOR.layer('shared')).toBe(`${ESC}36mshared${ESC}39m`);
  });
});

describe('detectStyle', () => {
  it('turns everything off when NO_COLOR is set', () => {
    expect(detectStyle({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true, 'linux')).toEqual({
      color: false,
      truecolor: false,
      unicode: false,
    });
  });

  it('turns everything off when not a TTY or TERM=dumb', () => {
    expect(detectStyle({}, false, 'linux').color).toBe(false);
    expect(detectStyle({ TERM: 'dumb' }, true, 'linux').color).toBe(false);
  });

  it('enables truecolor only for COLORTERM truecolor or 24bit', () => {
    expect(detectStyle({ COLORTERM: 'truecolor' }, true, 'linux').truecolor).toBe(true);
    expect(detectStyle({ COLORTERM: '24bit' }, true, 'linux').truecolor).toBe(true);
    expect(detectStyle({ COLORTERM: 'yes' }, true, 'linux').truecolor).toBe(false);
    expect(detectStyle({}, true, 'linux')).toEqual({ color: true, truecolor: false, unicode: true });
  });

  it('keeps color but drops unicode for a clearly non UTF-8 locale', () => {
    expect(detectStyle({ LANG: 'C' }, true, 'linux')).toEqual({
      color: true,
      truecolor: false,
      unicode: false,
    });
    expect(isUtf8Locale({ LC_ALL: 'en_US.ISO-8859-1', LANG: 'en_US.UTF-8' }, 'linux')).toBe(false);
    expect(isUtf8Locale({ LANG: 'en_US.utf8' }, 'linux')).toBe(true);
    expect(isUtf8Locale({ LANG: 'C' }, 'win32')).toBe(true);
    expect(isUtf8Locale({}, 'darwin')).toBe(true);
  });
});

describe('barCells', () => {
  it('is empty for zero, or when nothing has imports', () => {
    expect(barCells(0, 46)).toBe(0);
    expect(barCells(0, 0)).toBe(0);
  });

  it('shows at least one cell for any non-zero value', () => {
    expect(barCells(1, 1000)).toBe(1);
  });

  it('fills all cells for the maximum and never more', () => {
    expect(barCells(46, 46)).toBe(BAR_CELLS);
    expect(barCells(99, 46)).toBe(BAR_CELLS);
  });

  it('rounds up in between', () => {
    expect(barCells(31, 46)).toBe(11);
    expect(barCells(9, 46)).toBe(4);
    expect(barCells(23, 46)).toBe(8);
  });
});

describe('formatLayerTable', () => {
  it('renders the fixture table exactly, in plain mode', () => {
    expect(formatLayerTable(visuals, PLAIN_STYLE)).toBe(
      [
        ' LAYER           FILES  IMPORTS  SHARE             VIOLATIONS',
        ' ' + '-'.repeat(60),
        ' presentation        2        6  ################  2',
        ' application         1        2  ######..........  0',
        ' domain              1        0  ................  0',
        ' infrastructure      1        2  ######..........  1',
        ' composition         2        3  ########........  0',
      ].join('\n'),
    );
  });

  it('colors violation counts red when non-zero and dim when zero', () => {
    const table = formatLayerTable(visuals, UNICODE_16);
    expect(table).toContain(`${ESC}91m2${ESC}39m`);
    expect(table).toContain(`${ESC}90m0${ESC}39m`);
    expect(table).toContain('█');
    expect(table).toContain('░');
  });
});

describe('stats.importsByLayer', () => {
  it('counts the imports made by the files of each layer', () => {
    expect(visuals.stats.importsByLayer).toEqual({
      presentation: 6,
      application: 2,
      domain: 0,
      infrastructure: 2,
      composition: 3,
    });
  });
});

describe('machine formats are unchanged by 0.1.1', () => {
  for (const name of ['sample', 'cli-visuals']) {
    const resultFor = () => (name === 'sample' ? sample : visuals);

    it(`github output for ${name} is byte-for-byte identical`, () => {
      expect(formatGithub(resultFor())).toBe(golden(`${name}.github.txt`));
    });

    it(`compact output for ${name} is byte-for-byte identical`, () => {
      expect(formatCompact(resultFor())).toBe(golden(`${name}.compact.txt`));
    });

    it(`json output for ${name} only adds stats.importsByLayer`, () => {
      const parsed = JSON.parse(formatJson(resultFor())) as { stats: Record<string, unknown> };
      expect(parsed.stats.importsByLayer).toBeTypeOf('object');
      delete parsed.stats.importsByLayer;
      expect(JSON.stringify(parsed, null, 2)).toBe(golden(`${name}.json`));
    });
  }
});
