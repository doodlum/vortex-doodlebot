# Workflow rework: plan agreement

The user authorized the doodlebot rework only after multiple agents agreed on its plan,
then granted full permission for this repository. Backward compatibility is out of scope.
Vortex source code must not be modified.

The reviewed plan is canonical policy/brief alignment; named-owner live guards; explicit
nested execution contexts and full-duration build/launch exclusion; conditional kit renewal
and conservative recovery; strict revision-bound task-aware evidence; focused failure tests
and an author/independent-QA/handoff exercise. It adds no global scheduler.

Three independently assigned reviewers explicitly approved this final plan before the first
implementation edit on 2026-10-07:

| Reviewer                 | Verdict                                 | Conditions incorporated                                                                                                       |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| plan_routing_challenge   | AGREE: best practical path; no blockers | Fresh QA context, explicit publication authority, local-diff vs commit distinction, lightweight research                      |
| plan_isolation_challenge | AGREE: best practical path; no blockers | Separate ownership/exclusion, full operation duration, explicit nesting, acquisition-identity renewal, bounded fencing claims |
| plan_evidence_challenge  | AGREE: best practical path; no blockers | Task-aware controls, unexplained/stale evidence blocks readiness, E2E reconciliation, no legacy report adapters               |

The implementation must be verified against all these requirements. This record proves plan
agreement; it is not implementation QA or a claim that the implementation is complete.

## Vortex-only challenge and agreed refinement

Three fresh Astra/max reviewers independently inspected Vortex at
`34f3def8a044e2d681056ca4c2196188a64406b1`, recorded their complete plans, then inspected
committed doodlebot at `df5d2feef23b2dce2134d1433d299fad612741cb` before the draft. All three
retained one accountable owner, selective delegation, fresh QA and task-specific verification.
Seeing doodlebot changed their implementation choice to reuse its worktrees, slots and
fixtures, with stronger operation guards. Their inspections were read-only; no runtime
behavior was established by those reports.

The resulting refinement is:

1. Complete named-owner operation exclusion, known-child shutdown and restoration for all
   supported checkout mutations. Use finite guarded build/copy/reload cycles for watching;
   retain pending changes and release partial holds before retrying contention.
2. Select evidence by target, task, affected contracts and authorization: kit CI for kit
   changes, core for runtime contracts, meaningful scoped controls, app/performance checks
   where relevant, Vortex verify for submissions, and upstream E2E only when requested.
   Inspect applicability against the actual diff; declarations cannot waive affected checks.
3. Keep kit revision and Vortex build identity separate. Record actual command, cwd, source
   identity and runtime evidence. Reject stale current evidence, all-skipped E2E and
   unclassified changed failures. Readiness means evidence complete for handoff; upstream
   acceptance and release remain separate decisions.
4. Use a shared knowledge index with specialist reading paths, canonical owning documents
   and separate revision-bound task evidence. Distinguish authority, observations and
   hypotheses; promote only verified, scoped lessons. Document production and human
   governance boundaries without adding permission steps to already authorized kit work.
5. Validate with focused failure tests, kit CI, isolated official-release core and fresh
   QA/handoff. Synthetic repositories exercise mutations; this rework must not write or
   build Vortex source or temporarily patch its fixtures.

Before further implementation, `astra_vortex_plan_a` and `astra_vortex_plan_c` explicitly
reviewed this refinement on 2026-10-07 and each answered **agree: best practical path; no
plan blocker**. Implementation QA remains required. No global scheduler, legacy adapters,
separate specialist fact stores or knowledge database are planned.
