/**
 * Specifier resolution: turns `@/stores/cart`, `../domain/order`, `axios` or
 * `virtual:uno.css` into something the checker can judge.
 *
 * Resolution is deliberately file-system based rather than bundler based, so
 * the CLI behaves identically whether or not Vite is in the picture. The
 * `exists` hook keeps it unit-testable with a virtual file system.
 */

import fs from 'node:fs';
import path from 'node:path';

import { toPosix } from './matcher.js';
import type { ResolvedImport } from './types.js';

export interface ResolverOptions {
  /** Absolute project root. */
  root: string;
  /** Alias map, values are root-relative or absolute paths. */
  aliases: Record<string, string>;
  /** Extensions tried for extensionless specifiers. */
  extensions: string[];
  /** Override file-existence checks (tests, virtual file systems). */
  exists?: (absolutePath: string) => boolean;
}

export type Resolver = (specifier: string, importer: string) => ResolvedImport;

const IGNORED_PREFIXES = [
  '\0',
  'virtual:',
  'data:',
  'http:',
  'https:',
  '/@vite/',
  '/@id/',
  '/@fs/',
];

const IGNORED_EXTENSIONS = /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|eot|mp4|webm|md|txt|html|wasm)$/i;

function defaultExists(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/** Split `axios/dist/esm` into its package name and subpath. */
export function parsePackageSpecifier(specifier: string): {
  packageName: string;
  subpath: string;
} {
  if (specifier.startsWith('node:')) {
    return { packageName: specifier, subpath: '' };
  }
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return {
      packageName: segments.slice(0, 2).join('/'),
      subpath: segments.slice(2).join('/'),
    };
  }
  return {
    packageName: segments[0] as string,
    subpath: segments.slice(1).join('/'),
  };
}

export function createResolver(options: ResolverOptions): Resolver {
  const root = path.resolve(options.root);
  const exists = options.exists ?? defaultExists;
  const extensions = options.extensions;
  const cache = new Map<string, ResolvedImport>();

  // Longest alias first, so `@/components` wins over `@`.
  const aliases = Object.entries(options.aliases)
    .map(([from, to]) => ({
      from,
      to: path.isAbsolute(to) ? to : path.resolve(root, to),
    }))
    .sort((a, b) => b.from.length - a.from.length);

  const toRelative = (absolutePath: string): string | null => {
    const relative = path.relative(root, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return toPosix(relative);
  };

  const resolveOnDisk = (absolutePath: string): string | null => {
    if (path.extname(absolutePath) && exists(absolutePath)) return absolutePath;
    for (const extension of extensions) {
      const candidate = absolutePath + extension;
      if (exists(candidate)) return candidate;
    }
    for (const extension of extensions) {
      const candidate = path.join(absolutePath, 'index' + extension);
      if (exists(candidate)) return candidate;
    }
    return null;
  };

  const resolveInternal = (absolutePath: string, specifier: string): ResolvedImport => {
    const found = resolveOnDisk(absolutePath);
    if (!found) {
      return {
        target: 'unresolved',
        reason: `no file found for "${specifier}"`,
      };
    }
    const relative = toRelative(found);
    if (!relative) {
      return { target: 'ignored', reason: 'outside project root' };
    }
    return { target: 'internal', file: relative };
  };

  return (specifier: string, importer: string): ResolvedImport => {
    const key = `${importer}\u0000${specifier}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const result = resolve(specifier, importer);
    cache.set(key, result);
    return result;
  };

  function resolve(specifier: string, importer: string): ResolvedImport {
    if (!specifier) return { target: 'ignored', reason: 'empty specifier' };
    for (const prefix of IGNORED_PREFIXES) {
      if (specifier.startsWith(prefix)) {
        return { target: 'ignored', reason: `${prefix} specifier` };
      }
    }

    // Strip Vite/webpack resource queries: `./worker?worker`, `./img.png?url`.
    const withoutQuery = specifier.split('?')[0] as string;
    // A leading `#` is a Node subpath import (`#api/http`), not a fragment, so
    // only a `#` after the first character is stripped.
    const hash = withoutQuery.indexOf('#', 1);
    const bare = hash === -1 ? withoutQuery : withoutQuery.slice(0, hash);
    if (!bare) return { target: 'ignored', reason: 'query-only specifier' };
    if (IGNORED_EXTENSIONS.test(bare)) {
      return { target: 'ignored', reason: 'asset import' };
    }

    const importerDir = path.dirname(path.resolve(root, importer));

    for (const alias of aliases) {
      if (bare === alias.from || bare.startsWith(alias.from.replace(/\/$/, '') + '/')) {
        const rest = bare.slice(alias.from.replace(/\/$/, '').length).replace(/^\//, '');
        const absolute = rest ? path.join(alias.to, rest) : alias.to;
        return resolveInternal(absolute, specifier);
      }
    }

    if (bare.startsWith('./') || bare.startsWith('../') || bare === '.' || bare === '..') {
      return resolveInternal(path.resolve(importerDir, bare), specifier);
    }

    if (bare.startsWith('/')) {
      return resolveInternal(path.join(root, bare), specifier);
    }

    if (bare.startsWith('#')) {
      // A Node subpath import that no alias covers: 4layers cannot tell which
      // layer it lands in, so say so instead of guessing it is a package.
      return {
        target: 'unresolved',
        reason: `subpath import "${bare}" is not mapped in "aliases"`,
      };
    }

    const { packageName, subpath } = parsePackageSpecifier(bare);
    return { target: 'external', packageName, subpath };
  }
}
