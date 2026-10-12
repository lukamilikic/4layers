/**
 * Built-in presets.
 *
 * All three presets describe the same four layers and the same dependency
 * direction:
 *
 *   presentation -> application -> domain <- infrastructure
 *
 * plus a fifth, `composition`: the router and the app entry point. That is
 * where the layers get wired together, so it may import any of them, and no
 * layer may import it back.
 *
 * They differ in how much they let through:
 *
 * - `strict`   every edge the textbook forbids is an error, the domain layer
 *              may not touch node_modules at all, and every scanned file must
 *              belong to a layer.
 * - `classic`  the pragmatic default: the application layer may talk to
 *              infrastructure directly, the presentation layer may read domain
 *              types, and the domain layer keeps a framework/IO deny-list.
 * - `relaxed`  same edges as `classic`, reported as warnings, so you can adopt
 *              it on an existing codebase without turning CI red on day one.
 */

import type { LayerConfig, PresetName, RuleId, Severity } from './types.js';

/** Framework and UI-kit packages that must never reach domain or infra. */
export const UI_PACKAGES = [
  'vue',
  'vue-router',
  'vue-demi',
  'vue-i18n',
  '@vue/*',
  '@vueuse/*',
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'svelte',
  'vuetify',
  'quasar',
  'primevue',
  'element-plus',
  'naive-ui',
  '@headlessui/*',
  '@ionic/*',
];

/** Client-side state / data-orchestration packages: application layer only. */
export const STATE_PACKAGES = [
  'pinia',
  'vuex',
  'redux',
  '@reduxjs/*',
  'zustand',
  'swr',
  '@tanstack/*',
  'vue-query',
  'xstate',
  '@xstate/*',
];

/** Transport, persistence and third-party SDKs: infrastructure layer only. */
export const IO_PACKAGES = [
  'axios',
  'ky',
  'got',
  'superagent',
  'node-fetch',
  'undici',
  'graphql',
  'graphql-request',
  '@apollo/*',
  '@urql/*',
  'firebase',
  '@firebase/*',
  '@supabase/*',
  'localforage',
  'dexie',
  'idb',
  'idb-keyval',
  '@aws-sdk/*',
  '@azure/*',
  '@google-cloud/*',
  'mqtt',
  'socket.io-client',
  'pusher-js',
  'ably',
  '@stripe/*',
  '@sentry/*',
  'posthog-js',
  'mixpanel-browser',
];

/** Default file globs per layer, following common Vue project conventions. */
export const DEFAULT_LAYER_FILES: Record<string, string[]> = {
  presentation: [
    'src/components/**',
    'src/views/**',
    'src/pages/**',
    'src/layouts/**',
    'src/ui/**',
    'src/presentation/**',
    '**/*.vue',
  ],
  application: [
    'src/application/**',
    'src/stores/**',
    'src/store/**',
    'src/composables/**',
    'src/queries/**',
    'src/mutations/**',
    'src/app/**',
  ],
  domain: [
    'src/domain/**',
    'src/entities/**',
    'src/models/**',
    'src/use-cases/**',
    'src/usecases/**',
  ],
  infrastructure: [
    'src/infrastructure/**',
    'src/infra/**',
    'src/api/**',
    'src/http/**',
    'src/services/**',
    'src/repositories/**',
    'src/adapters/**',
    'src/storage/**',
    'src/gateways/**',
  ],
  composition: [
    'src/router/**',
    'src/routes/**',
    'src/main.{ts,js,mts,mjs}',
    'src/bootstrap/**',
    'src/composition/**',
  ],
};

const DESCRIPTIONS: Record<string, string> = {
  presentation:
    'UI components, views and user interaction. Renders state and emits events.',
  application:
    'Application-specific orchestration: state, routing, workflows, data fetching.',
  domain:
    'Framework-agnostic business rules, entities and use cases. Depends on nothing.',
  infrastructure:
    'External world: HTTP, storage, SDKs, edge functions. Implements domain ports.',
  composition:
    'Composition root: router and app entry. Wires every layer together; nothing imports it.',
};

export interface Preset {
  name: PresetName;
  layers: Record<string, LayerConfig>;
  severity: Record<RuleId, Severity>;
  allowSelfImports: boolean;
  typeOnlyImports: 'check' | 'ignore';
}

function withFiles(layer: string, config: Omit<LayerConfig, 'files'>): LayerConfig {
  return {
    files: DEFAULT_LAYER_FILES[layer] as string[],
    description: DESCRIPTIONS[layer],
    ...config,
  };
}

const CLASSIC: Preset = {
  name: 'classic',
  allowSelfImports: true,
  typeOnlyImports: 'check',
  layers: {
    presentation: withFiles('presentation', {
      canImport: ['application', 'domain'],
      packages: { deny: IO_PACKAGES },
    }),
    application: withFiles('application', {
      canImport: ['domain', 'infrastructure'],
    }),
    domain: withFiles('domain', {
      canImport: [],
      packages: { deny: [...UI_PACKAGES, ...STATE_PACKAGES, ...IO_PACKAGES] },
    }),
    infrastructure: withFiles('infrastructure', {
      canImport: ['domain'],
      packages: { deny: [...UI_PACKAGES, ...STATE_PACKAGES] },
    }),
    composition: withFiles('composition', {
      canImport: ['*'],
    }),
  },
  severity: {
    'layer-dependency': 'error',
    'package-boundary': 'error',
    'unassigned-file': 'off',
    'unresolved-import': 'off',
    'self-import': 'off',
    'unknown-layer': 'warn',
  },
};

const STRICT: Preset = {
  name: 'strict',
  allowSelfImports: true,
  typeOnlyImports: 'check',
  layers: {
    presentation: withFiles('presentation', {
      canImport: ['application'],
      packages: { deny: [...IO_PACKAGES, ...STATE_PACKAGES] },
    }),
    // Infrastructure is injected into the application layer, never imported:
    // the application layer only knows the ports declared in the domain.
    application: withFiles('application', {
      canImport: ['domain'],
      packages: { deny: IO_PACKAGES },
    }),
    domain: withFiles('domain', {
      canImport: [],
      packages: { allow: [] },
    }),
    infrastructure: withFiles('infrastructure', {
      canImport: ['domain'],
      packages: { deny: [...UI_PACKAGES, ...STATE_PACKAGES] },
    }),
    composition: withFiles('composition', {
      canImport: ['*'],
    }),
  },
  severity: {
    'layer-dependency': 'error',
    'package-boundary': 'error',
    'unassigned-file': 'error',
    'unresolved-import': 'warn',
    'self-import': 'off',
    'unknown-layer': 'error',
  },
};

const RELAXED: Preset = {
  name: 'relaxed',
  allowSelfImports: true,
  typeOnlyImports: 'ignore',
  layers: {
    presentation: withFiles('presentation', {
      canImport: ['application', 'domain'],
      packages: { deny: IO_PACKAGES },
    }),
    application: withFiles('application', {
      canImport: ['domain', 'infrastructure'],
    }),
    domain: withFiles('domain', {
      canImport: [],
      packages: { deny: [...UI_PACKAGES, ...IO_PACKAGES] },
    }),
    infrastructure: withFiles('infrastructure', {
      canImport: ['domain'],
      packages: { deny: UI_PACKAGES },
    }),
    composition: withFiles('composition', {
      canImport: ['*'],
    }),
  },
  severity: {
    'layer-dependency': 'warn',
    'package-boundary': 'warn',
    'unassigned-file': 'off',
    'unresolved-import': 'off',
    'self-import': 'off',
    'unknown-layer': 'warn',
  },
};

export const presets: Record<PresetName, Preset> = {
  strict: STRICT,
  classic: CLASSIC,
  relaxed: RELAXED,
};

export const DEFAULT_PRESET: PresetName = 'classic';

/**
 * Files scanned when the user does not narrow it down. Only `src/`, so root
 * config files (vite.config.ts, .eslintrc.js) are not reported as layerless.
 */
export const DEFAULT_INCLUDE = ['src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue}'];

/** Never scanned, whatever `include` says. */
export const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/.vite/**',
  '**/*.d.ts',
  '**/*.spec.*',
  '**/*.test.*',
  '**/__tests__/**',
  '**/__mocks__/**',
];

/** Extensions tried when a specifier has none. */
export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.json',
];

export function getPreset(name: PresetName | undefined): Preset {
  const preset = presets[name ?? DEFAULT_PRESET];
  if (!preset) {
    const known = Object.keys(presets).join(', ');
    throw new Error(`Unknown preset "${name}". Available presets: ${known}.`);
  }
  return preset;
}
