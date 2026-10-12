// Reference config for a Vue 3 + Pinia + TanStack Query shop.
import { defineConfig } from '4layers';

export default defineConfig({
  extends: 'classic',
  include: ['src/**/*.{ts,vue}'],

  layers: {
    presentation: {
      files: ['src/components/**', 'src/views/**', 'src/layouts/**', '**/*.vue'],
      canImport: ['application', 'domain'],
    },
    application: {
      files: ['src/stores/**', 'src/composables/**', 'src/queries/**', 'src/router/**'],
      canImport: ['domain', 'infrastructure'],
    },
    domain: {
      files: ['src/domain/**'],
      canImport: [],
      // Pure TypeScript plus validation; nothing that knows about Vue or HTTP.
      packages: { allow: ['zod'] },
    },
    infrastructure: {
      files: ['src/api/**', 'src/storage/**'],
      canImport: ['domain'],
    },
  },

  severity: {
    'unassigned-file': 'warn',
  },
});
