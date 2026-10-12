import { describe, expect, it } from 'vitest';

import { createMatcher, expandPattern, globToRegExp, specificity, toPosix } from '../src/matcher.js';

describe('toPosix', () => {
  it('normalises Windows separators and leading ./', () => {
    expect(toPosix('src\\domain\\order.ts')).toBe('src/domain/order.ts');
    expect(toPosix('./src/a.ts')).toBe('src/a.ts');
  });
});

describe('expandPattern', () => {
  it('treats an extension-less, magic-less pattern as a directory', () => {
    expect(expandPattern('src/domain')).toBe('src/domain/**');
    expect(expandPattern('src/domain/')).toBe('src/domain/**');
  });

  it('leaves real globs and file patterns alone', () => {
    expect(expandPattern('src/**/*.vue')).toBe('src/**/*.vue');
    expect(expandPattern('src/main.ts')).toBe('src/main.ts');
  });
});

describe('globToRegExp', () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it('matches a single star within one segment only', () => {
    expect(matches('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matches('src/*.ts', 'src/nested/a.ts')).toBe(false);
  });

  it('matches a globstar across segments, including zero', () => {
    expect(matches('src/**/*.vue', 'src/a.vue')).toBe(true);
    expect(matches('src/**/*.vue', 'src/views/deep/a.vue')).toBe(true);
    expect(matches('src/domain/**', 'src/domain/order.ts')).toBe(true);
    expect(matches('src/domain/**', 'src/domainish/order.ts')).toBe(false);
  });

  it('supports brace alternation, including nesting', () => {
    expect(matches('**/*.{ts,vue}', 'src/a.vue')).toBe(true);
    expect(matches('**/*.{ts,vue}', 'src/a.js')).toBe(false);
    expect(matches('src/{a,b/{c,d}}/*.ts', 'src/b/d/x.ts')).toBe(true);
  });

  it('supports character classes and negation', () => {
    expect(matches('src/[ab].ts', 'src/a.ts')).toBe(true);
    expect(matches('src/[!ab].ts', 'src/a.ts')).toBe(false);
    expect(matches('src/[!ab].ts', 'src/c.ts')).toBe(true);
  });

  it('escapes regex metacharacters in literals', () => {
    expect(matches('src/a+b.ts', 'src/a+b.ts')).toBe(true);
    expect(matches('src/a+b.ts', 'src/aab.ts')).toBe(false);
  });

  it('matches package names used by the deny-lists', () => {
    expect(matches('@tanstack/*', '@tanstack/vue-query')).toBe(true);
    expect(matches('@tanstack/*', '@tanstack/vue-query/build')).toBe(false);
    expect(matches('axios', 'axios')).toBe(true);
  });
});

describe('createMatcher', () => {
  it('reports which pattern matched', () => {
    const matcher = createMatcher(['src/domain/**', '**/*.vue']);
    expect(matcher.match('src/domain/order.ts')).toBe('src/domain/**');
    expect(matcher.match('src/views/Cart.vue')).toBe('**/*.vue');
    expect(matcher.match('README.md')).toBe(null);
  });

  it('can be built without directory expansion for package patterns', () => {
    const matcher = createMatcher(['vue'], { expand: false });
    expect(matcher('vue')).toBe(true);
    expect(matcher('vue/dist')).toBe(false);
  });
});

describe('specificity', () => {
  it('ranks literal segments above wildcards', () => {
    expect(specificity('src/domain/**')).toBeGreaterThan(specificity('**/*.vue'));
    expect(specificity('src/components/**')).toBeGreaterThan(specificity('src/**'));
  });
});
