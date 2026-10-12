/**
 * Project file collection, without a glob dependency.
 *
 * Directories are pruned as early as possible: a directory is skipped when the
 * exclude patterns match it, which keeps `node_modules` out of the walk
 * instead of filtering its files afterwards.
 */

import fs from 'node:fs';
import path from 'node:path';

import { createMatcher, toPosix, type Matcher } from './matcher.js';

export interface WalkOptions {
  root: string;
  include: string[];
  exclude: string[];
  /** Hard cap, guards against walking into a surprise symlink loop. */
  maxFiles?: number;
}

// Pruned regardless of config, so a custom `exclude` can never make the walk
// descend into dependencies or VCS metadata.
const ALWAYS_SKIP = new Set(['node_modules', '.git', '.hg', '.svn']);

/** Collect project-relative POSIX paths of every file to scan. */
export function walkProject(options: WalkOptions): string[] {
  const { root } = options;
  const include = createMatcher(options.include);
  const exclude = createMatcher(options.exclude);
  const maxFiles = options.maxFiles ?? 50_000;
  const files: string[] = [];

  const visit = (absoluteDir: string, relativeDir: string): void => {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (exclude(relative) || exclude(`${relative}/`)) continue;
        visit(path.join(absoluteDir, entry.name), relative);
        continue;
      }

      if (!entry.isFile()) continue;
      if (exclude(relative)) continue;
      if (!include(relative)) continue;
      files.push(relative);
    }
  };

  visit(path.resolve(root), '');
  files.sort();
  return files;
}

const scanMatcherCache = new Map<string, { include: Matcher; exclude: Matcher }>();

/**
 * True when a file should be scanned at all. Called on every Vite transform,
 * so the compiled matchers are cached per pattern set.
 */
export function shouldScan(
  relativePath: string,
  options: { include: string[]; exclude: string[] },
): boolean {
  const key = `${options.include.join('\u0000')}\u0001${options.exclude.join('\u0000')}`;
  let matchers = scanMatcherCache.get(key);
  if (!matchers) {
    matchers = {
      include: createMatcher(options.include),
      exclude: createMatcher(options.exclude),
    };
    scanMatcherCache.set(key, matchers);
  }
  const relative = toPosix(relativePath);
  return matchers.include(relative) && !matchers.exclude(relative);
}
