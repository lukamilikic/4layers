/**
 * Layer assignment and rule evaluation.
 *
 * A file belongs to the layer whose matching pattern is the most specific, not
 * simply the first one declared. That is what lets the default preset claim
 * every `**\/*.vue` file for the presentation layer while a deliberate
 * `src/domain/**` pattern still wins for a component-shaped file that lives in
 * the domain.
 */

import { createMatcher, specificity, type Matcher } from './matcher.js';
import type { PackagePolicy, ResolvedConfig } from './types.js';

export interface LayerAssignment {
  /** Owning layer, or null when no layer claims the file. */
  layer: string | null;
  /** The glob that claimed it, for `4layers explain`. */
  pattern: string | null;
  /** Set when a layer would have matched but an `exclude` pattern won. */
  excludedBy?: { layer: string; pattern: string };
}

export interface PackageVerdict {
  allowed: boolean;
  /** Which policy decided it. */
  reason: 'no-policy' | 'allow-list' | 'deny-list' | 'not-in-allow-list';
  pattern?: string;
}

export interface LayerIndex {
  layerOf(file: string): LayerAssignment;
  canImport(from: string, to: string): boolean;
  checkPackage(layer: string, packageName: string, fullSpecifier: string): PackageVerdict;
  /** Layer names that do not exist but are referenced by a `canImport`. */
  unknownReferences(): Array<{ layer: string; references: string }>;
}

interface CompiledLayer {
  name: string;
  order: number;
  files: Matcher;
  exclude: Matcher | null;
  canImport: Set<string>;
  allowAll: boolean;
  packages: PackagePolicy | undefined;
  allowMatcher: Matcher | null;
  denyMatcher: Matcher | null;
}

export function createLayerIndex(config: ResolvedConfig): LayerIndex {
  const compiled: CompiledLayer[] = config.layerNames.map((name, order) => {
    const layer = config.layers[name]!;
    const canImport = layer.canImport ?? [];
    return {
      name,
      order,
      files: createMatcher(layer.files),
      exclude: layer.exclude?.length ? createMatcher(layer.exclude) : null,
      canImport: new Set(canImport),
      allowAll: canImport.includes('*'),
      packages: layer.packages,
      allowMatcher: layer.packages?.allow
        ? createMatcher(layer.packages.allow, { expand: false })
        : null,
      denyMatcher: layer.packages?.deny?.length
        ? createMatcher(layer.packages.deny, { expand: false })
        : null,
    };
  });

  const byName = new Map(compiled.map((layer) => [layer.name, layer]));
  const assignmentCache = new Map<string, LayerAssignment>();

  function layerOf(file: string): LayerAssignment {
    const cached = assignmentCache.get(file);
    if (cached) return cached;

    let best: { layer: CompiledLayer; pattern: string; score: number } | null = null;
    let excludedBy: LayerAssignment['excludedBy'];

    for (const layer of compiled) {
      const pattern = layer.files.match(file);
      if (!pattern) continue;
      const excludedPattern = layer.exclude?.match(file);
      if (excludedPattern) {
        excludedBy ??= { layer: layer.name, pattern: excludedPattern };
        continue;
      }
      const score = specificity(pattern);
      if (!best || score > best.score) best = { layer, pattern, score };
    }

    const assignment: LayerAssignment = best
      ? { layer: best.layer.name, pattern: best.pattern }
      : { layer: null, pattern: null, excludedBy };
    assignmentCache.set(file, assignment);
    return assignment;
  }

  function canImport(from: string, to: string): boolean {
    if (from === to) return config.allowSelfImports;
    const layer = byName.get(from);
    if (!layer) return true;
    return layer.allowAll || layer.canImport.has(to);
  }

  function checkPackage(
    layerName: string,
    packageName: string,
    fullSpecifier: string,
  ): PackageVerdict {
    const layer = byName.get(layerName);
    if (!layer || !layer.packages) return { allowed: true, reason: 'no-policy' };

    const subjects = [packageName, fullSpecifier];

    if (layer.denyMatcher) {
      for (const subject of subjects) {
        const pattern = layer.denyMatcher.match(subject);
        if (pattern) return { allowed: false, reason: 'deny-list', pattern };
      }
    }

    if (layer.allowMatcher) {
      for (const subject of subjects) {
        const pattern = layer.allowMatcher.match(subject);
        if (pattern) return { allowed: true, reason: 'allow-list', pattern };
      }
      return { allowed: false, reason: 'not-in-allow-list' };
    }

    return { allowed: true, reason: 'no-policy' };
  }

  function unknownReferences(): Array<{ layer: string; references: string }> {
    const unknown: Array<{ layer: string; references: string }> = [];
    for (const layer of compiled) {
      for (const reference of layer.canImport) {
        if (reference === '*') continue;
        if (!byName.has(reference)) unknown.push({ layer: layer.name, references: reference });
      }
    }
    return unknown;
  }

  return { layerOf, canImport, checkPackage, unknownReferences };
}
