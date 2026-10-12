# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
