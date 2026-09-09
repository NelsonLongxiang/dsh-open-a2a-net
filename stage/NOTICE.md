# NOTICE - dsh-a2a-munder-difflin lineage

Floor visualization adapted from Munder Difflin
https://github.com/chaitanyagiri/munder-difflin (MIT (c) Chaitanya Giri).

- Vendored: src/scene/office/* renderer modules, design tokens, office.tmj,
  tileset PNGs. Upstream MIT license: assets/MUNDER-DIFFLIN-LICENSE.
- SeatPool.ts is itself ported upstream from shahar061/the-office.
- Tile art: LimeZu, under assets/LIMEZUASSETS-LICENSE.txt (attribution kept).
- DSH adaptations: slim zustand store shim (src/store/store.ts) projecting the
  plugin REST faces (/__dsh_a2a/state) onto the floor; window.cth bridge
  (src/feed.ts) for routing envelopes + owed tasks; Vite wiring to emit a
  static bundle served by the plugin at /__dsh_a2a_canvas.
