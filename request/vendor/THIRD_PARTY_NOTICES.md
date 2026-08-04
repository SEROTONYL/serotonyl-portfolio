# Vendored third-party code

## three.js r0.180.0

- Source: https://github.com/mrdoob/three.js (MIT License)
- Vendored files:
  - `three.module.min.js`, fetched from
    https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js
    on 2026-08-03.
  - `three.core.min.js`, fetched from
    https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.min.js
    on 2026-08-04.
- Note on the wrapper+core split: since three@0.180, the published build
  is split into a thin ES module wrapper (`three.module.min.js`) that
  itself does `import ... from "./three.core.min.js"` for the bulk of the
  library code. Both files must be vendored together and kept side by
  side — vendoring only the wrapper looks correct at a glance (it parses,
  it has a valid `export`) but 404s at runtime the moment a browser tries
  to resolve the relative `./three.core.min.js` import. This gap was
  caught in Task 6 review after the wrapper-only vendoring in Task 1.
- Why vendored instead of loaded from a CDN at runtime: the project's
  CLAUDE.md mandates a fully static, dependency-free vanilla JS site;
  this is a conscious, documented exception for the sakura foliage 3D
  render only (see `docs/superpowers/specs/2026-08-03-sakura-foliage-3d-design.md`
  and CLAUDE.md's "Технологии" section).
- To upgrade: re-run BOTH curl commands below with the new version pin
  (do not upgrade only the wrapper), then re-run the full Playwright
  visual check from this plan's Task 8 before committing — three.js minor
  versions have changed material/shader internals before.

  ```bash
  curl -sSL -o vendor/three.module.min.js https://cdn.jsdelivr.net/npm/three@<version>/build/three.module.min.js
  curl -sSL -o vendor/three.core.min.js https://cdn.jsdelivr.net/npm/three@<version>/build/three.core.min.js
  ```
