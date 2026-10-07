# Agent and subagent workflow

This is the canonical coordination policy. [The operating manual](AGENTS.md) owns commands;
[WORKFLOWS](WORKFLOWS.md) owns Vortex reproductions and submission gates;
[TESTING](TESTING.md) owns kit gates. [Knowledge routes](KNOWLEDGE-ROUTES.md) maps specialist
reading. User instructions determine scope and authorized actions; a worker brief or saved
lesson cannot expand them.

## Establish scope before routing

Record the requested outcome, repository, allowed actions, explicit exclusions and completion
evidence. Distinguish inspecting source from changing it, launching a disposable app from
using a person's profile, and preparing a branch from publishing it. Propagate the user's
existing authorization accurately; routine authorized work needs no repeated confirmation.

For this workflow rework, doodlebot edits and isolated kit checks are authorized. Vortex source
is read-only: no application fixes, Vortex source builds, temporary fixture patches or
revert controls in that checkout. Exercise mutation paths in synthetic
repositories and runtime contracts against a released Vortex. This task's boundary is an
example, not a permanent restriction on separately authorized Vortex development.

| Decision or action                                                                 | Responsibility                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Research, scoped edits and disposable checks                                       | Agents proceed within the brief and existing authorization.                                                   |
| Account sign-in, MFA and captcha                                                   | The account owner completes the interactive action; agents can use an authorized private cache.               |
| Product behavior, destructive user-data changes or additional access outside scope | The accountable owner resolves the concrete decision with the user before the dependent action.               |
| Vortex commit, push, issue communication or PR                                     | Requires the user's authorization for that action; preparing evidence does not grant it.                      |
| Upstream acceptance, merge, signing and release                                    | Maintainers and the authorized release process decide; an agent readiness result grants none of these powers. |

Vortex's own checkout instructions govern a contribution. At the inspected baseline,
`CONTRIBUTING.md` requires one logical change, an author who understands every submitted line,
and maintainer agreement before large or multi-extension work. Its size guidance is not a
substitute for assessing blast radius. `AGENTS.md` requires full verify for submission, says
E2E runs only when asked, and forbids local signed packaging. `.github/CODEOWNERS` names the
Vortex developers and E2E QA owners; it does not prove remote branch protection is configured.
Re-read these sources at the task's revision rather than treating this summary as permanent.

Production suitability includes affected consumers, failure/recovery paths, persistent data,
extension APIs, security/privacy, accessibility and performance where relevant. The human
submitter must read and understand the final diff. Agent consensus and passing tests do not
replace that responsibility. Harness-only adapters, fixture bypasses and automation hooks
are not automatically appropriate production code. A production-facing API change needs its
own consumer analysis, security assessment and any applicable maintainer agreement.

## Route the task

| Task                              | Arrangement                                                               | Completion evidence                                                           |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Research or planning              | One issue owner; independent readers for distinct questions when useful   | Source-grounded findings, alternatives and uncertainties                      |
| Setup, login, shared provisioning | One operator before parallel work                                         | Doctor, isolated launch and requested setup checks                            |
| Small fix or coupled refactor     | One author; selective specialists                                         | Scoped checks, applicable control and independent review                      |
| Independent Vortex issues         | Fresh issue context and owner; separate checkout/slot when driving        | Separate reproduction, implementation and evidence                            |
| Kit changes                       | One writer under the kit lock; read-only reviewers                        | Kit CI; released-app core for runtime contracts                               |
| UI/design                         | One author while decisions evolve; QA after criteria settle               | Relevant state/size matrix and visible evidence                               |
| Independent QA                    | Fresh context and identified revision; separate app/checkout when driving | Independent reproduction, boundary checks and findings                        |
| Performance                       | Sequential base/head runs on an idle machine                              | Production mode, comparable fixtures, at least three runs per side and spread |

One accountable owner integrates each issue, resolves findings, checks evidence and cleans up.
Use the smallest arrangement that adds useful independent evidence. There is no fixed agent
hierarchy or global scheduler. Do not split coupled changes among concurrent writers.
Read-only readers need neither worktrees nor app slots. Reuse suitable owned worktrees and
fixtures. Parallel readers should use saved UI snapshots; taking a new snapshot invalidates
the renderer's existing references.

## Brief a worker

Send the complete brief; do not assume conversation history is inherited.

```text
Role and question: author / independent QA / specialist / research
Issue and neutral reproduction:
Acceptance criteria:
Allowed actions and their authorization; explicit exclusions:
Repository and relevant instruction/knowledge entry points:
Revision: base SHA and head SHA, or identified local diff
Owner; checkout; slot; cache and endpoints, if used:
Affected contracts; required checks and justified inapplicability:
Evidence/report destination:
Active processes/resources, lock acquisition/expiry and cleanup responsibility:
```

Independent QA starts with `fork_turns="none"` or an equivalent fresh context. Give it the
neutral issue, criteria, constraints and primary sources before the author's proposed cause.
Label author evidence as claims, while preserving relevant prior failures and constraints.
QA does not edit production code, publish or use the author's live app. A branch review does
not require an existing PR. A local-diff review records content identity; final submission
gates must identify the actual final commit.

Stop a review when its design or reviewed content changes. Production changes need renewed QA
of the final change and affected interactions. Test-only changes need scoped checks and their
applicable control. Reuse evidence only after establishing revision, selection, fixture,
runtime and credential equivalence; never relabel an old run as rerun.

## Own resources

Every supported live operation and provisioning command needs a named owner. Keep owner,
checkout and slot consistent. Owner leases reserve apps/checkouts across commands. Operation
guards exclude independent conflicting commands, including commands with the same owner,
for their full duration. Only intentional nested commands receive an execution context;
never copy one into independent workers or parallel mutations.

Nested contention refuses immediately. A root retry releases all partial holds before waiting.
Provision shared dependencies/output before fan-out. Use supported guarded install/build/launch
and copy paths. Stop the app before rewriting its checkout output. Extension watching uses
finite guarded build/copy/reload cycles and releases protection between cycles; source edits
remain pending through contention.

Authorized kit publication follows lock, sync, edit, CI, commit, push, unlock. The user's
scope and the repository's narrow kit-lessons exception determine whether commit/push are
allowed; taking a lock grants no publication authority. For a no-commit task, preserve the
identified diff and explicitly hand off its lock acquisition/expiry and cleanup responsibility
to the accountable owner. Do not unlock a dirty tree or discard it to satisfy the procedure.
Keep one kit writer. The parent may
pass its writer baton to one delegated author under its held kit lock, but stops editing until
the baton returns. Other workers return findings and candidate lessons.

Renew the existing acquisition before expiry. Expired/replaced ownership stops further
mutations; inspect state rather than silently reacquiring, discarding work or releasing
another acquisition. Known child processes retain protection until confirmed exit. An
interrupted agent does not imply its subprocesses stopped. If push rebases to a different
head, verify that head before publishing it.

Guards cover supported harness paths. Raw MCP/CDP, manual filesystem/Git writes, external
builders and unknown shell descendants remain cooperative trust boundaries. A lock is not
a security sandbox and cannot undo a running Git operation. Report uncertain recovery
explicitly. Ordinary release must preserve ownership of an app that is still running.

## Verify and hand off

Select checks by target, task and affected contracts, then have QA inspect applicability
against the actual diff. Documentation-only labels cannot waive changed executable behavior.
Kit changes run CI; affected runtime contracts also run the account-free released-app core.
Vortex submissions run its full verify on the final commit; E2E is additional and only runs
when requested. UI and performance evidence apply to the affected behavior, with reasons for
inapplicable checks. Missing permission or prerequisites produce a concrete blocker.

Bug fixes need the intended failing assertion without the fix. Import, compilation, setup,
timeout and unrelated failures are inconclusive. Features need absent-behavior or wiring
evidence; equivalence refactors need invariant/consumer coverage; documentation needs factual,
link and command checks. A test should exercise the real constraint and relevant failure path.

Run scoped checks first, independent QA next, resolve findings, then expensive final gates.
A successful command exit alone is insufficient. Account for missing tests, all-skipped runs,
selection/configuration differences, passed-to-skipped outcomes, flaky reruns and changed
failure causes. Preserve the first outcome of diagnostic reruns.

Use `evidence identity`, `evidence runtime` and `evidence run` to record concrete local
identities and execution, then `readiness --manifest <file>` to check the current schema.
See the operating manual for commands. Keep kit, Vortex source and built runtime identities
separate. Readiness means evidence complete for handoff. Hashes detect drift; they do not
authenticate reviewers or prove that an assertion, risk assessment or build claim is true.
Exploration and blocked evidence cannot declare final readiness.

```text
Verdict: verified / changes required / externally blocked
Reviewed revision and baseline:
Acceptance criterion -> independent evidence and result:
Checks -> passed / failed / inconclusive / not applicable / blocked, with reasons:
Control -> task-appropriate test and why its outcome establishes the claim:
E2E -> selection, regressions, existing failures, omissions and dispositions, if requested:
Performance -> runtime, fixture, runs, spread and machine conditions, when applicable:
Findings -> severity, file:line, confirmation and disposition:
Uncertainty and concrete unblock step:
Cleanup -> stopped/retained processes, leases, worktrees and next owner:
Candidate lessons -> evidence, scope, proposed canonical home, or none:
```

Save authorized reports to task artifacts and link the next brief to them. Honor chat-only
or no-write requests. Never save credentials or unnecessary private user data. Completion
requires evidence for the requested outcome or an honest, concrete external blocker.

## Improve from verified lessons

1. Capture a candidate in the task report: symptom, revisions, conditions, first failure,
   observed evidence, suspected/confirmed cause and proposed reusable improvement.
2. Check the mechanism in code and, where authorized, reproduce it and test a relevant boundary
   or counterexample. Qualify platform, release and fixture limits. Reject unsupported
   generalizations; a task-specific fact need not become a global rule.
3. Choose one canonical home through the knowledge index. Prefer fixing missing automation
   and adding a meaningful failure regression. Keep incident history, measurements and
   unresolved hypotheses in task artifacts.
4. Make the smallest complete authorized change under the kit lock. Run applicable checks.
   Material behavior or policy changes receive fresh independent review of cause, coverage,
   scope and practical cost before publication.
5. Correct or revert disproved changes, update dependent links and retire obsolete workarounds.
   Keep useful preventive tests even after an incident stops recurring. Git history provides
   the audit trail; no transcript-ingestion service or separate knowledge database is needed.

Automation captures provenance, checks consistency and runs tests. Agents diagnose and review.
Humans set authority and remain responsible for upstream submissions and product decisions.
Improvement cannot silently expand permissions, weaken acceptance criteria, bypass ownership
or turn a blocked check into a pass. An incorrect test or obsolete gate can be changed within
scope, with the original outcome retained and the correction explained and independently reviewed.

Judge improvements on comparable later tasks: fewer recurring failures, earlier detection,
less duplicate investigation and fewer private workarounds. Also inspect false refusals,
contradictory guidance, excessive reading and slower routine work. Do not reward producing
more lessons or obtaining greener results by omitting coverage.
