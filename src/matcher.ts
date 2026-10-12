/**
 * A small, dependency-free glob matcher.
 *
 * It supports the subset that path and package patterns actually need:
 * `*`, `**`, `?`, `{a,b}` (nestable) and `[abc]` / `[!abc]` classes.
 * Everything is matched against POSIX-separated, project-relative paths.
 */

const MAGIC = /[*?[\]{}]/;

/** Normalise any OS path into the form the matcher expects. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Expand DX shorthands: a pattern with no glob syntax and no file extension is
 * treated as a directory, so `src/domain` means `src/domain/**`.
 */
export function expandPattern(pattern: string): string {
  const p = toPosix(pattern).replace(/\/+$/, '');
  if (MAGIC.test(p)) return p;
  const last = p.slice(p.lastIndexOf('/') + 1);
  if (last.includes('.')) return p;
  return p + '/**';
}

function escapeLiteral(char: string): string {
  return /[.+^$()|\\/]/.test(char) ? '\\' + char : char;
}

/** Compile a single glob into an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  const g = toPosix(glob);
  let source = '';
  let braces = 0;
  let i = 0;

  while (i < g.length) {
    const char = g[i] as string;

    if (char === '*') {
      let end = i;
      while (g[end] === '*') end++;
      const starCount = end - i;
      const prevIsBoundary = i === 0 || g[i - 1] === '/';
      const nextIsSlash = g[end] === '/';

      if (starCount >= 2 && prevIsBoundary) {
        if (nextIsSlash) {
          // `a/**/b` must also match `a/b`
          source += '(?:[^/]*\\/)*';
          i = end + 1;
          continue;
        }
        if (end >= g.length) {
          source += '.*';
          i = end;
          continue;
        }
      }
      source += '[^/]*';
      i = end;
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      i++;
      continue;
    }

    if (char === '{') {
      source += '(?:';
      braces++;
      i++;
      continue;
    }

    if (char === '}' && braces > 0) {
      source += ')';
      braces--;
      i++;
      continue;
    }

    if (char === ',' && braces > 0) {
      source += '|';
      i++;
      continue;
    }

    if (char === '[') {
      let end = i + 1;
      let body = '';
      if (g[end] === '!' || g[end] === '^') {
        body += '^';
        end++;
      }
      for (; end < g.length && g[end] !== ']'; end++) {
        body += (g[end] as string).replace(/[\\\]^]/g, '\\$&');
      }
      if (end < g.length) {
        source += '[' + body + ']';
        i = end + 1;
        continue;
      }
      source += '\\[';
      i++;
      continue;
    }

    source += escapeLiteral(char);
    i++;
  }

  source += ')'.repeat(braces);
  return new RegExp('^' + source + '$');
}

export interface Matcher {
  (path: string): boolean;
  /** Returns the pattern that matched, which `explain` reports. */
  match(path: string): string | null;
  patterns: string[];
}

/** Build a matcher that returns true when any of `patterns` matches. */
export function createMatcher(patterns: string[], options: { expand?: boolean } = {}): Matcher {
  const expand = options.expand !== false;
  const expanded = patterns.map((p) => (expand ? expandPattern(p) : toPosix(p)));
  const compiled = expanded.map((p) => globToRegExp(p));

  const match = (path: string): string | null => {
    const subject = toPosix(path);
    for (let i = 0; i < compiled.length; i++) {
      if ((compiled[i] as RegExp).test(subject)) return expanded[i] as string;
    }
    return null;
  };

  const matcher = ((path: string) => match(path) !== null) as Matcher;
  matcher.match = match;
  matcher.patterns = expanded;
  return matcher;
}

/**
 * Specificity score for a pattern, used to decide which layer owns a file when
 * several layers match it. Literal path segments weigh most, so
 * `src/domain/**` wins over a catch-all `**` + `*.vue` pattern.
 */
export function specificity(pattern: string): number {
  const segments = toPosix(pattern).split('/');
  let score = 0;
  for (const segment of segments) {
    if (segment === '**') continue;
    if (!MAGIC.test(segment)) score += 10;
    else if (segment === '*') score += 1;
    else score += 3;
  }
  return score;
}
