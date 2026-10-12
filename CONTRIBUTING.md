# Contributing

Thanks for helping keep frontend layers honest.

## Setup

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsup -> dist/
```

Try the CLI against the fixture app:

```bash
npm run build
node dist/cli.js check --root test/fixtures/sample
```

## Ground rules

- **No runtime dependencies.** The scanner, matcher, resolver and CLI are
  hand-rolled on purpose. Dev dependencies are fine.
- **Every bug fix comes with a test.** Fixtures live in `test/fixtures/`.
- **Keep `checkFile` fast.** The Vite plugin calls it on every transform.

## Layout

| File               | Responsibility                                       |
| ------------------ | ---------------------------------------------------- |
| `src/scanner.ts`   | Find import specifiers and ignore directives.        |
| `src/resolver.ts`  | Turn a specifier into a project file or a package.   |
| `src/matcher.ts`   | Glob matching and specificity scoring.               |
| `src/layers.ts`    | Assign files to layers, evaluate edges and packages. |
| `src/checker.ts`   | Orchestrate a file or whole-project check.           |
| `src/config.ts`    | Load and normalise config, infer aliases.            |
| `src/presets.ts`   | `strict`, `classic`, `relaxed`.                      |
| `src/report.ts`    | Output formats.                                      |
| `src/vite.ts`      | Vite plugin.                                         |
| `src/cli.ts`       | The `4layers` command.                               |

## Releasing

1. Update `CHANGELOG.md`.
2. `npm version <patch|minor|major>` — this tags the commit.
3. `git push --follow-tags` — the release workflow publishes to npm.
