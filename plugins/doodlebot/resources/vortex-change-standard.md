# Vortex Change Standard

This standard defines the bar for a design of a Vortex change or a doodlebot
change. It extends EGM's feature-spec and implementation-readiness standards.
Use those for the design's soundness and actionability; use this one for the
parts doodlebot checks mechanically and for runtime proof.

## Core Principle

A design passes if a fresh agent with doodlebot and the stated authorizations
can implement it inside the listed files and then **prove** every acceptance
criterion on a real app, without choosing a fixture, a target or a check
itself.

## Machine-checked format

`doodlebot design check <file>` enforces these. A design that fails them fails
this standard.

- **Header bullets** (before the first `##` heading): `**Status:**` is one of
  `Draft`, `Proposed`, `In Review`, `Approved`; `**Target:**` is `vortex` or
  `doodlebot`. An approved design, and only an approved design, has
  `**Approved:** <person>; content <sha256>; <reference>`, where the digest is
  the one `design check` printed for the text the person approved.
- **Required sections**: `## Overview`, `## The Problem`, `## Goals`,
  `## Non-Goals`, `## Open Questions`, `## Acceptance Criteria`,
  `## Affected Contracts`, `## Technical Plan (Architecture)`,
  `## Alternatives Considered`, `## Detailed Implementation Plan`,
  `### Verification Plan`.
- **Acceptance criteria**: bullets of the form ``- `id`: criterion``, with
  unique lower-case ids. These ids are the readiness manifest's acceptance
  ids.
- **Affected contracts**: bullets naming `runtime`, `ui`, `persistent-data`,
  `public-api` or `performance` in backticks, or a bullet starting `None`.
- **File boundary**: entries ``#### N. `path` (Create|Modify|Delete)`` under
  `## Detailed Implementation Plan`, and backticked paths on bullets under
  `### Target Scope & File Boundary`. Paths are relative to the root of the
  repository being changed. Use exact paths; use a glob only for generated
  files whose names cannot be known in advance. List every test, document,
  regenerated reference and index (`designs/SITEMAP.md`) the change touches.
- **Approved means closed**: no bullets under `## Open Questions` except
  `None`, and no `TBD` outside code.
- **Formatted before review**: run `pnpm exec oxfmt <design>` before taking the
  digest a review records; formatting changes the digest.

## Requirements

- **Target and revision**: released Vortex version or source base for a
  Vortex change; the kit base for a doodlebot change.
- **Reproduction** (behavior changes): the user's own scenario, the observed
  symptom on the base, and the observation that will show it gone.
- **Fixture and prerequisites**: sandbox, Bethesda sandbox, disposable game
  copy, offline or pinned collection; any login, Premium, purchased game or
  user data, and who provides it.
- **Authorization**: app launch, Vortex source mutation, upstream E2E,
  commit, push and PR, as the user granted them.
- **Compatibility** (doodlebot changes): the extension keeps working against
  stock, released Vortex; main-process work is in the harness over CDP.
- **Verification plan mapped to readiness roles**: for each criterion, the
  command or test that proves it and its readiness role (`scoped-tests`,
  `control`, `app-qa`, `kit-core`, `kit-ci`, `vortex-verify`, `performance`,
  `vortex-e2e`), with a reason for each role the readiness rules would
  require but the plan omits.
- **Controls**: an intended failing assertion for a bug fix; absent-behavior
  or wiring evidence for a feature; invariants and consumers for a refactor.
- **UI and performance**: a state and window-size matrix for UI changes;
  production builds, a comparable baseline and at least three runs per side
  for performance claims.
