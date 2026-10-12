# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
