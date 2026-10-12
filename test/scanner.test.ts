import { describe, expect, it } from 'vitest';

import { collectDirectives, isSilenced, maskComments, maskNonScript, scanImports } from '../src/scanner.js';

const specifiers = (code: string, filename = 'a.ts') =>
  scanImports(code, filename).imports.map((record) => record.specifier);

describe('scanImports', () => {
  it('finds static, bare, namespace and renamed imports', () => {
    const code = [
      "import a from './a';",
      "import * as b from './b';",
      "import { c as d } from './c';",
      "import './side-effect';",
      "import defaults, { named } from 'pkg';",
    ].join('\n');
    expect(specifiers(code)).toEqual(['./a', './b', './c', './side-effect', 'pkg']);
  });

  it('finds re-exports, dynamic imports and require calls', () => {
    const code = [
      "export { a } from './a';",
      "export * from './b';",
      "const c = () => import('./c');",
      "const d = require('./d');",
    ].join('\n');
    expect(specifiers(code)).toEqual(['./a', './b', './c', './d']);
  });

  it('handles multi-line import clauses', () => {
    const code = ['import {', '  a,', '  b,', "} from '@/domain/order';"].join('\n');
    const [record] = scanImports(code, 'a.ts').imports;
    expect(record?.specifier).toBe('@/domain/order');
    expect(record?.line).toBe(1);
  });

  it('reports 1-based line and column of the statement', () => {
    const code = ["const x = 1;", "", "  import { y } from './y';"].join('\n');
    const [record] = scanImports(code, 'a.ts').imports;
    expect(record?.line).toBe(3);
    expect(record?.column).toBe(3);
  });

  it('marks type-only imports, including all-type named clauses', () => {
    const code = [
      "import type { A } from './a';",
      "import { type B } from './b';",
      "import { type C, d } from './c';",
      "export type { E } from './e';",
    ].join('\n');
    const records = scanImports(code, 'a.ts').imports;
    expect(records.map((record) => [record.specifier, record.typeOnly])).toEqual([
      ['./a', true],
      ['./b', true],
      ['./c', false],
      ['./e', true],
    ]);
  });

  it('ignores imports inside comments', () => {
    const code = [
      "// import { a } from './a';",
      "/* import { b } from './b'; */",
      "/**",
      " * import { c } from './c';",
      " */",
      "import { d } from './d';",
    ].join('\n');
    expect(specifiers(code)).toEqual(['./d']);
  });

  it('is not derailed by a quote inside a regex literal', () => {
    const code = ["const re = /['\"]/;", "import { a } from './a';"].join('\n');
    expect(specifiers(code)).toEqual(['./a']);
  });

  it('reads only the script blocks of a .vue SFC', () => {
    const code = [
      '<template>',
      "  <p>import { nope } from './nope'</p>",
      '</template>',
      '',
      '<script setup lang="ts">',
      "import { a } from './a';",
      '</script>',
      '',
      '<style>',
      '@import "./x.css";',
      '</style>',
    ].join('\n');
    const records = scanImports(code, 'components/A.vue').imports;
    expect(records.map((record) => record.specifier)).toEqual(['./a']);
    expect(records[0]?.line).toBe(6);
  });

  it('finds imports in both script blocks of an SFC', () => {
    const code = [
      '<script lang="ts">',
      "import { a } from './a';",
      '</script>',
      '<script setup lang="ts">',
      "import { b } from './b';",
      '</script>',
    ].join('\n');
    expect(specifiers(code, 'A.vue')).toEqual(['./a', './b']);
  });

  it('keeps the file length stable when masking', () => {
    const code = '<template>x</template>\n<script>let a = 1;</script>\n';
    expect(maskNonScript(code)).toHaveLength(code.length);
    expect(maskComments('// a\n/* b */ c\n')).toHaveLength('// a\n/* b */ c\n'.length);
  });
});

describe('directives', () => {
  it('collects a file-level disable', () => {
    const directives = collectDirectives('// 4layers-disable-file\nimport a from "x";');
    expect(directives.disableFile).toBe(true);
    expect(isSilenced(directives, 2, 'layer-dependency')).toBe(true);
  });

  it('collects a next-line disable for all rules', () => {
    const code = ['// 4layers-disable-next-line', "import a from './a';"].join('\n');
    const directives = collectDirectives(code);
    expect(isSilenced(directives, 2, 'layer-dependency')).toBe(true);
    expect(isSilenced(directives, 3, 'layer-dependency')).toBe(false);
  });

  it('collects a next-line disable scoped to one rule', () => {
    const code = ['// 4layers-disable-next-line package-boundary', "import a from 'axios';"].join('\n');
    const directives = collectDirectives(code);
    expect(isSilenced(directives, 2, 'package-boundary')).toBe(true);
    expect(isSilenced(directives, 2, 'layer-dependency')).toBe(false);
  });

  it('accepts the ignore- spelling and block comments', () => {
    const directives = collectDirectives('/* 4layers-ignore-next-line layer-dependency */\nx');
    expect(isSilenced(directives, 2, 'layer-dependency')).toBe(true);
  });
});
