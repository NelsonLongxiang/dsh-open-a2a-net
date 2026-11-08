# Third-party notices

This package is MIT-licensed (see `LICENSE`). It also contains, or is adapted from, the following third-party work. Their
licence texts ship with the package under `docs/licenses/`.

| Component | Where | Licence | Text |
|---|---|---|---|
| [Munder Difflin](https://github.com/chaitanyagiri/munder-difflin) office renderer (© 2026 Chaitanya Giri) | the full-page office stage `/__dsh_a2a_canvas` (`stage/` → `assets/stageDist`) | MIT | `docs/licenses/munder-difflin-MIT.txt` |
| [the-office](https://github.com/shahar061/the-office) seat pool and office maps (© 2026 shahar061) | `stage/src/scene/office/SeatPool.ts`, `stage/src/assets/maps/` | ISC | `docs/licenses/the-office-ISC.txt` |
| [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) domain engine (© 2026 DeepSeek Harness Team), vendored unchanged | `src/superagent/upstream/` → `lib/superagent/upstream/` | MIT | `docs/licenses/dsh-superagent-MIT.txt` |

## Not shipped: LimeZu tilesets

The office stage was drawn with LimeZu's *Modern Interiors - RPG Tileset [16X16]* (<https://limezu.itch.io/>), used under
its Complete Version licence (`docs/licenses/limezu-assets-license.txt`). That licence forbids redistributing the art, so
this package does not contain it. A licensee puts `office-tileset.png`, `a5-office-floors-walls.png` and `interiors.png`
in the host's stage-tiles directory (`stageTilesDir`, default `<home>/a2a/stage-tiles`); the stage then shows them, with
the credit link LimeZu requires. Without them it draws placeholder tiles. Versions up to and including 0.7.0, and git
history before this change, still contain the tilesets (#471).
