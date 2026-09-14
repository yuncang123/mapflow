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
