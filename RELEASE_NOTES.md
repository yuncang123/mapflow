# Mapflow v0.6.0

Mapflow v0.6.0 adds trustworthy end-to-end map evolution playback while preserving the repository-external, read-only projection boundary.

## Highlights

- Records a real blank genesis frame before the initial origin and destination fog nodes appear.
- Adds a hash-chained `wayfinding-events.jsonl` journal for question answers, human targets, evidence references, and canonical draft snapshots.
- Bridges the frozen Wayfinding head into the first runtime event, then reuses the existing runtime event projections through Evidence and arrival audit.
- Adds read-only, ETag-enabled evolution catalog and as-of frame APIs with semantic node, edge, Fact, Evidence, and Acceptance diffs.
- Adds an accessible Cytoscape evolution player with scrubber, first/previous/play/next/live controls, speed selection, historical-mode warnings, and live-update notifications.
- Preserves semantic element positions across frames and highlights added or changed map objects without introducing new frontend dependencies.
- Marks legacy history as partial and fails closed on journal, hash-chain, bridge, or current-draft drift instead of inventing prehistory.
- Keeps definition-only `board --map` views isolated from any adjacent runtime journals; evolution is read only from an explicit Sidecar state.
- Keeps child maps as independent streams; historical parent frames never leak a child map's current state.

## Verification

- `npm test`: 110/110 passed.
- `npm run test:regression`: deterministic Oracle and Runtime result PASS, 110 tests.
- `npm run benchmark:doctor`: all seven case packages and the impact map passed contract validation.
- Full software-project evolution fixture: 32 recorded frames from blank genesis through arrival audit.
- Browser acceptance: blank, initial fog, goal-regression, play/pause, scrubber, and return-to-live states verified; no browser console errors.
- `git diff --check`: passed.
- Global installer dry-run: 24 distribution entries resolved.

## Evidence Boundary

Historical frames are read-only projections of recorded snapshots. They do not become execution authority and do not prove real-world arrival. Existing sidecars created before v0.6.0 can replay only their recorded runtime segment or a later migration anchor; Mapflow explicitly reports that coverage gap. Agent segments, complete external-project journeys, and the release matrix were not run by the deterministic regression command.
