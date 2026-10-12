#!/usr/bin/env node
/**
 * The `4layers` command.
 *
 *   4layers check              check the project, exit 1 on violations
 *   4layers graph              print the layer graph (mermaid / dot / json)
 *   4layers explain <file>     show which layer owns a file and why
 *   4layers init               write a starter config
 *
 * Hand-rolled argument parsing keeps the package dependency-free.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createChecker } from './checker.js';
import { loadConfig, resolveConfig } from './config.js';
import { format, formatLayerTable, paint, paintLayer, type ReportFormat } from './report.js';
import type { FourLayersUserConfig, PresetName } from './types.js';

const require_ = createRequire(import.meta.url);

function version(): string {
  try {
    const pkg = require_('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

interface Args {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[body] = next;
        i++;
      } else {
        flags[body] = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      flags[token.slice(1)] = true;
      continue;
    }
    positionals.push(token);
  }

  const command = positionals[0] && !positionals[0].includes('.') ? positionals.shift()! : 'check';
  return { command, positionals, flags };
}

const HELP = `
${paint.bold('4layers')} — keep your frontend layers honest.

  ${paint.bold('Usage')}
    4layers [command] [options]

  ${paint.bold('Commands')}
    check [files...]     Check the project (default command)
    graph                Print the layer dependency graph
    explain <file>       Show which layer owns a file, and why
    init                 Write a starter 4layers.config.mjs
    help                 Show this help

  ${paint.bold('Options')}
    --root <dir>         Project root (default: cwd)
    --config <file>      Path to a config file
    --preset <name>      strict | classic | relaxed (overrides config)
    --format <name>      pretty | compact | json | github | mermaid | dot
    --max-warnings <n>   Fail when warnings exceed n (default: unlimited)
    --stats              Print the per-layer table
    --quiet              Only print the summary line
    --no-hints           Hide the "how to fix" hints
    --version            Print the version
    --help               Show this help

  ${paint.bold('Examples')}
    4layers check
    4layers check --preset strict --format github
    4layers check src/components/CartView.vue
    4layers graph --format mermaid > docs/layers.mmd
    4layers explain src/stores/cart.ts
`;

function fail(message: string): never {
  process.stderr.write(`${paint.red('4layers')} ${message}\n`);
  process.exit(2);
}

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * File arguments typed in a shell are relative to the shell, not to the
 * project root, so they are made absolute before the checker relativises them.
 */
function resolveTargets(positionals: string[]): string[] {
  return positionals.map((target) => path.resolve(process.cwd(), target));
}

const PRESETS: PresetName[] = ['strict', 'classic', 'relaxed'];

async function buildChecker(args: Args) {
  const root = path.resolve(asString(args.flags.root) ?? process.cwd());
  const configPath = asString(args.flags.config);
  const loaded = await loadConfig(root, configPath);

  const overrides: FourLayersUserConfig = {};
  const preset = asString(args.flags.preset);
  if (preset) {
    if (!PRESETS.includes(preset as PresetName)) {
      fail(`unknown preset "${preset}". Use one of: ${PRESETS.join(', ')}.`);
    }
    overrides.extends = preset as PresetName;
  }

  const config = resolveConfig(
    { ...loaded.user, ...overrides },
    { root: args.flags.root ? root : loaded.root, configFile: loaded.configFile },
  );

  return { checker: createChecker(config), config, configFile: loaded.configFile };
}

async function commandCheck(args: Args): Promise<number> {
  const { checker, config, configFile } = await buildChecker(args);
  const formatName = (asString(args.flags.format) ?? 'pretty') as ReportFormat;
  const quiet = args.flags.quiet === true;
  const hideHints = args.flags['no-hints'] === true;

  const result = args.positionals.length
    ? checker.checkFiles(resolveTargets(args.positionals))
    : checker.checkProject();

  if (hideHints) {
    for (const violation of result.violations) delete violation.hint;
  }

  const isMachine = formatName === 'json' || formatName === 'github';

  if (!isMachine && !quiet) {
    const source = configFile
      ? path.relative(process.cwd(), configFile) || path.basename(configFile)
      : `no config file, using the "${config.extends}" preset`;
    process.stdout.write(`${paint.gray(`4layers ${version()} · ${source}`)}\n\n`);
  }

  const output = quiet && !isMachine ? '' : format(result, formatName);
  if (output) process.stdout.write(output + '\n');

  if (args.flags.stats === true && !isMachine) {
    process.stdout.write('\n' + formatLayerTable(result) + '\n');
  }
  if (quiet && !isMachine) {
    process.stdout.write(
      `${result.errorCount} error(s), ${result.warningCount} warning(s)\n`,
    );
  }

  const maxWarnings = asString(args.flags['max-warnings']);
  const warningLimit = maxWarnings === undefined ? Infinity : Number(maxWarnings);
  if (Number.isNaN(warningLimit)) fail('--max-warnings expects a number.');

  if (result.errorCount > 0) return 1;
  if (result.warningCount > warningLimit) return 1;
  return 0;
}

async function commandGraph(args: Args): Promise<number> {
  const { checker } = await buildChecker(args);
  const formatName = (asString(args.flags.format) ?? 'mermaid') as ReportFormat;
  const result = checker.checkProject();
  process.stdout.write(format(result, formatName) + '\n');
  return 0;
}

async function commandExplain(args: Args): Promise<number> {
  const target = args.positionals[0];
  if (!target) fail('explain needs a file: 4layers explain src/stores/cart.ts');

  const { checker, config } = await buildChecker(args);
  const info = checker.explain(path.resolve(process.cwd(), target));

  if (!info.layer) {
    process.stdout.write(
      `${paint.bold(info.file)}\n  layer: ${paintLayer(null)}\n` +
        `  ${paint.gray(`No layer glob matches this file. Layers: ${config.layerNames.join(', ')}.`)}\n`,
    );
    return 0;
  }

  const absolute = path.resolve(config.root, info.file);
  const lines = [
    paint.bold(info.file),
    `  layer:      ${paintLayer(info.layer)}  ${paint.gray(`(matched ${info.pattern})`)}`,
    `  may import: ${info.canImport.length ? info.canImport.join(', ') : paint.gray('(nothing)')}`,
  ];
  if (info.description) lines.push(`  role:       ${paint.gray(info.description)}`);

  if (fs.existsSync(absolute)) {
    const violations = checker.checkFile(info.file, fs.readFileSync(absolute, 'utf8'));
    lines.push(
      violations.length
        ? `  status:     ${paint.red(`${violations.length} violation(s)`)}`
        : `  status:     ${paint.green('clean')}`,
    );
    for (const violation of violations) {
      lines.push(`    ${violation.line}:${violation.column}  ${violation.message}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

const TEMPLATE = (preset: PresetName) => `import { defineConfig } from '4layers';

export default defineConfig({
  // strict | classic | relaxed — see https://github.com/lmilikich/4layers#presets
  extends: '${preset}',

  // Files the checker looks at.
  include: ['src/**/*.{js,ts,jsx,tsx,vue}'],

  // Tell 4layers where your layers live. These are merged over the preset,
  // so you only list what differs from the conventional layout.
  layers: {
    presentation: {
      files: ['src/components/**', 'src/views/**', 'src/layouts/**', '**/*.vue'],
      canImport: ['application', 'domain'],
    },
    application: {
      files: ['src/stores/**', 'src/composables/**', 'src/router/**'],
      canImport: ['domain', 'infrastructure'],
    },
    domain: {
      files: ['src/domain/**'],
      canImport: [],
    },
    infrastructure: {
      files: ['src/api/**', 'src/repositories/**', 'src/storage/**'],
      canImport: ['domain'],
    },
  },
});
`;

async function commandInit(args: Args): Promise<number> {
  const root = path.resolve(asString(args.flags.root) ?? process.cwd());
  const preset = (asString(args.flags.preset) ?? 'classic') as PresetName;
  if (!PRESETS.includes(preset)) {
    fail(`unknown preset "${preset}". Use one of: ${PRESETS.join(', ')}.`);
  }

  const target = path.join(root, '4layers.config.mjs');
  if (fs.existsSync(target) && args.flags.force !== true) {
    fail(`${path.relative(process.cwd(), target)} already exists. Pass --force to overwrite.`);
  }

  fs.writeFileSync(target, TEMPLATE(preset), 'utf8');
  process.stdout.write(
    `${paint.green('Created')} ${path.relative(process.cwd(), target) || target}\n` +
      `${paint.gray('Next: npx 4layers check')}\n`,
  );
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version === true || args.flags.v === true) {
    process.stdout.write(version() + '\n');
    return 0;
  }
  if (args.flags.help === true || args.flags.h === true || args.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  switch (args.command) {
    case 'check':
      return commandCheck(args);
    case 'graph':
      return commandGraph(args);
    case 'explain':
      return commandExplain(args);
    case 'init':
      return commandInit(args);
    default:
      fail(`unknown command "${args.command}". Run \`4layers help\`.`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${paint.red('4layers')} ${message}\n`);
    process.exit(2);
  });
