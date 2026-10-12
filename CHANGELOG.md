# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-12

### Changed

- New `4layers check` output: violations are grouped by layer edge
  (`presentation → infrastructure`, `presentation → axios`), each with its
  locations, the offending specifier and one `fix` line per distinct hint.
- The summary line now reads `✖ 3 errors · 0 warnings · 42 files · 118 imports · 31ms`,
  or `✔ All layers respected · ...` on a clean run.
- `--stats` prints a restyled table before the violations, with FILES,
  IMPORTS, a SHARE bar scaled to the busiest layer, and VIOLATIONS per layer.
- The check header now names the preset: `4layers 0.1.1 · classic preset`,
  followed by the config file when there is one.
- Layer colors use 24-bit color when `COLORTERM` is `truecolor` or `24bit`,
  and the closest 16-color codes otherwise.
- Without color (not a TTY, `NO_COLOR`, `TERM=dumb`) or with a non UTF-8
  locale, the report uses ASCII symbols: `x`, `!`, `ok`, `->`, `#` and `.`.

### Added

- `stats.importsByLayer` in the check result and in `--format json`: the
  number of imports made by the files of each layer.
- Exports for custom reporters: `groupViolations`, `barCells`, `createStyle`,
  `detectStyle`, `defaultStyle`, `PLAIN_STYLE`.
- README screenshot of the colored output, generated from the real CLI with
  `npm run docs:screenshot`.

### Unchanged

- `--format github`, `compact`, `json` (apart from the new field), `mermaid`
  and `dot`, exit codes, `--quiet`, `--max-warnings`, `explain`, `graph` and
  `init`.

## [0.1.0] - 2026-10-12

### Added

- Layer checker for the presentation / application / domain / infrastructure
  model, with `strict`, `classic` and `relaxed` presets.
- Rules: `layer-dependency`, `package-boundary`, `unassigned-file`,
  `unresolved-import`, `self-import`, `unknown-layer`.
- Dependency-free import scanner with native `.vue` SFC support and type-only
  import detection.
- Alias resolution from config, `tsconfig.json` paths and Vite `resolve.alias`.
- `4layers-disable-next-line` / `4layers-disable-file` directives.
- Vite plugin (`4layers/vite`): dev overlay and build failure.
- CLI: `check`, `graph`, `explain`, `init`; `pretty`, `compact`, `json`,
  `github`, `mermaid` and `dot` output.
- `composition` layer in every preset for the router and app entry
  (`src/router/**`, `src/main.*`). It may import every layer; nothing may
  import it. Importing it gets a `useRouter()` hint.
- `src/store/**` (singular) is recognised as the application layer.

### Changed

- `src/router/**` moved from `application` to `composition`, so a router
  lazy-loading views is no longer reported.
- The default `include` scans `src/` only, so root config files are no longer
  listed as belonging to no layer.

### Fixed

- The Vite plugin reported every violation twice during `vite build`: once
  from the startup scan and again per module.
