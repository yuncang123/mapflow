# Mapflow v0.9.1

Mapflow v0.9.1 makes the live Board legible as a task activity map: the first screen answers destination, current position, and next action, while advanced evidence and history stay available on demand.

## Highlights

- Simplifies the Board hierarchy by keeping the complete route visible and moving gap and goal-regression lenses into a secondary view.
- Rewrites next-action copy around user decisions and outcomes instead of internal Edge, Brief, and Agent terminology.
- Projects Work Edges as task activity cards between typed milestones, with distinct start, join, decision, and end markers.
- Preserves parallel branches and live route recomputation while keeping the Board read-only and truthful about stale sources.

## Verification

- `npm test`: 140/140 passed.
- `npm run benchmark:doctor`: all seven case packages and the impact map passed contract validation.
- Board API returned `source_status=current` after restart; the temporary sample Board was stopped.
- `git diff --check`: passed, with Windows line-ending conversion warnings only.

## Evidence Boundary

This release is backed by deterministic local tests, fixtures, and a local read-only Board. It does not prove deployment, production behavior, long-running enterprise use, accessibility, market demand, or product value.

# Mapflow v0.9.0

Mapflow v0.9.0 turns the audited map into a living navigation field: an Arrival becomes an immutable historical checkpoint, a human-confirmed successor continues from that checkpoint in the same map identity, and trusted Fact changes re-compute current route state without rewriting history.

## Highlights

- Adds Arrival Checkpoints and explicit `continue` successor-leg binding with origin snapshots and drift-aware current Destination satisfaction.
- Keeps historical Arrival evidence immutable while projecting current facts as satisfied, unsatisfied, or drifted.
- Adds a read-only live Board with a complete Route Set lens, SSE revision notifications, authoritative API readback, and polling fallback.
- Preserves trusted-fact and human-controlled Destination boundaries; notifications, model output, and unconfirmed proposals cannot become Facts.
- Adds compatibility, continuity, drift, route-set, SSE, and full-regression coverage, including a self-bootstrap map for the living-navigation capability.

## Verification

- `npm test`: 137/137 passed.
- `npm run benchmark:doctor`: all eight case packages and the impact map passed contract validation.
- `npm run demo:evolution -- --no-serve`: completed with `arrival_status=audited`.
- `git diff --check`: passed.

## Evidence Boundary

This release is backed by deterministic local tests, fixtures, and a local read-only Board. It does not prove deployment, production behavior, long-running enterprise use, accessibility, market demand, or product value.

# Mapflow v0.8.0

Mapflow v0.8.0 refocuses the product on one contract: regress a destination into a causally valid map, prove a route forward from sourced Facts, let a human or Agent execute only trusted Work Edges, and finish with an independent Arrival audit.

## Highlights

- Adds schema 3 causal contracts with explicit premises, conclusions, rule basis, witnesses, non-interference claims, and deterministic derivation digests.
- Separates structural completeness, causal soundness, forward reachability, executed derivation, and audited arrival so a plausible plan cannot be mistaken for a proven route.
- Lets ordinary proven edges start directly while retaining explicit authorization for protected actions.
- Freezes verifier commands and issues one-use capabilities; only executed checks, external readback, or child-map receipts can update Facts. Reported observations remain non-authoritative.
- Preserves historical proof certificates across changes to unverified future work and rejects redefinition of already verified edge contracts.
- Adds bounded `focus`, `work`, `evidence`, and `history` context layers plus compact Task Brief handoff contracts for product, frontend, backend, test, support, and leadership interfaces.
- Adds a complete Library System evolution package that demonstrates reverse regression, parallel implementation slices, Evidence-driven Fact updates, and audited Arrival.
- Retains hash-chained, read-only map evolution playback and projects causal proofs and runtime evidence without turning the board into execution authority.
- Keeps Mapflow a single-computer, repository-external sidecar. It does not become a collaboration workspace or replace Git, issue tracking, CI, review, release, or team communication.

## Verification

- `npm test`: 134/134 passed.
- `npm run benchmark:doctor`: all seven case packages and the impact map passed contract validation.
- `npm run demo:evolution -- --no-serve`: completed with `arrival_status=audited`.
- Syntax checks for the core, runtime, proof, board, and evolution demo entry points passed.
- `git diff --check`: passed, with Windows line-ending conversion warnings only.

## Compatibility

- Existing legacy maps remain readable as history.
- New workflow maps use the explicit causal contract and evidence levels; legacy Route Approval is no longer part of the active execution path.
- Existing sidecars created before evolution journaling may expose only their recorded runtime segment or a later migration anchor.

## Evidence Boundary

This release is backed by deterministic local tests and fixtures. It does not prove deployment, production behavior, long-running enterprise use, accessibility, market demand, or product value. Those claims still require evidence from real projects and people.
