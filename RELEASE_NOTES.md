# Mapflow Release Notes

> 本文件按版本保存当时已经发布的能力和证据边界。历史版本中的产品表述不定义当前使命；当前使命与行为分别以 `README.md`、`CONTEXT.md` 和 `docs/workflow.md` 为准。

## Mapflow v0.10.1

Mapflow v0.10.1 aligns the public story, domain language, Agent entry, templates, CLI messages, and Board around one mission: clear, reliable navigation maps for every task.

### Highlights

- Defines Task as the user's whole undertaking and Work Edge as one bounded part of its Navigation Map.
- Makes clarity and reliability explicit product properties without narrowing Mapflow to software delivery or complex work.
- Reduces README to product orientation, quick start, and document routing; `docs/workflow.md` remains the behavioral source of truth.
- Separates current truth from dated Research, Wayfinding, self-bootstrap maps, and archived model snapshots without rewriting historical evidence.
- Makes repository reconnaissance, role handoffs, context contracts, branches, joins, and submaps conditional on the task's actual shape.
- Corrects stale ADR and CLI wording around executed verifiers, stale child receipts, Workspace Head, and sidecars for non-Git tasks.

### Verification

- `npm test`: 148 passed, 0 failed.
- `npm run benchmark:doctor`: seven case packages and the impact map passed structural validation.
- Markdown relative-link check: no broken targets.
- `git diff --check`: passed apart from platform line-ending notices.

### Evidence Boundary

These checks prove the source contracts, fixtures, documentation links, and local Board response covered by this release. They do not prove complete coverage of every task type, a full Agent benchmark journey, installation refresh on another machine, production deployment, adoption, or business value.

## Mapflow v0.10.0

Mapflow v0.10.0 makes the Workspace Head the single current revision for the Board, CLI, and Agent entry, so stale context cannot overwrite the current navigation map.

### Highlights

- Adds one Workspace Head that binds Wayfinding or runtime events, source digests, state projection, and the exact runtime build.
- Requires snapshot-based reads and `expected_revision` compare-and-swap writes with locked readback and recovery.
- Makes the Board a direct projection of the same Head and source files, with explicit “recorded” versus “applied” feedback.
- Detects source/runtime/installed-package version drift before writes.
- Simplifies the first screen for people who do not know Mapflow's internal model while retaining evidence and advanced detail on demand.

### Verification

- Release commit `08d455d5bb02460ac9e5d2b879e38e2a9abe0684` was published as tag `v0.10.0`.

### Evidence Boundary

The release identity and repository state prove publication of this source revision. Deterministic tests and fixtures prove only their covered contracts; they do not prove every task type, long-running adoption, deployment, accessibility, market demand, or business value.

## Mapflow v0.9.2

Mapflow v0.9.2 keeps the user-level package to one explicit Mapflow router while retaining its five phase instructions as progressively disclosed references.

## Highlights

- Installs only `mapflow/SKILL.md` as a discoverable skill; destination shaping, repository reconnaissance, blueprint planning, edge slicing, and edge delivery are ordinary references beneath the package.
- Records the single entry skill and the five phase references separately in the installation manifest.
- Uses `agents/openai.yaml` as the explicit-invocation control and removes the unsupported legacy invocation field from Skill frontmatter.
- Extends the global installer regression to reject recursively discoverable phase skills.

## Verification

- `npm test`: 140/140 passed.
- `npm run benchmark:doctor`: all seven case packages and the impact map passed contract validation.
- `npm run demo:evolution -- --no-serve`: completed with an audited Arrival.
- `git diff --check`: passed, with Windows line-ending conversion warnings only.

## Evidence Boundary

This release proves the local source, installer, package layout, deterministic fixtures, and demo path. It does not prove production deployment, external host refresh behavior, team adoption, or business value.

## Mapflow v0.9.1

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

## Mapflow v0.9.0

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

## Mapflow v0.8.0

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
