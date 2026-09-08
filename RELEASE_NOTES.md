# Mapflow v0.5.5

Mapflow v0.5.5 is a personal-use preview release for evidence-driven, multiresolution work mapping.

## Highlights

- Adds a user-level runtime with repository-external workspace sidecars and automatic `enable` recovery.
- Models Intent, four-valued Facts, Proposals, Decisions, Edge Runs, Evidence, Acceptance, and independent arrival audit gates.
- Adds human-confirmed destination shaping and destination-first goal regression before a formal Blueprint is registered.
- Adds nested submaps with immutable child receipts, stale detection, and readable collapsed summary nodes.
- Reworks the local Cytoscape board for live read-only projection, wayfinding questions, route lenses, and expand/collapse interaction.
- Adds a seven-case product-experience benchmark matrix with deterministic Oracle/Runtime checks and isolated Agent/Release journeys.

## Verification

- `npm test`: 100/100 passed.
- `npm run test:regression`: deterministic Oracle and Runtime checks passed, 100/100 tests.
- `npm run benchmark:doctor`: all seven case packages and the impact map passed contract validation.
- `git diff --check`: passed.
- Global installer dry-run: 21 distribution entries resolved.

## Evidence Boundary

This release is ready for a small personal human trial. Deterministic checks and synthetic reviewer evidence have passed, but the complete seven-case Release journey matrix has not been executed against this fixed commit. It is therefore published as a GitHub prerelease, not as proof of long-term product value, production readiness, or broad user acceptance.
