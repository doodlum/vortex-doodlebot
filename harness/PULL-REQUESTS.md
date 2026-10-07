# Vortex pull requests: titles, descriptions and review

[WORKFLOWS.md](WORKFLOWS.md#before-a-vortex-pull-request-is-ready) defines applicable submission
gates; [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md) defines scope, delegation, evidence and human
responsibility. Vortex's current `CONTRIBUTING.md` takes precedence. Keep one logical change,
link the issue and report platform/checks. Its approximate 400-line/10-file guidance is not
a substitute for assessing blast radius; discuss large or multi-extension work with maintainers
before implementing it. The submitter must understand every line.

## Title

Use Conventional Commits, such as `fix(collections): ...` or `perf(ui): ...`, with an
appropriate area. State the resulting behavior in plain words. Keep it under about 72
characters; put issue links in the body. Rewrite the title and description when the final
scope changes so a maintainer can assess the result without conversation history.

## Description

Use these sections in order. Scale detail to the change and place evidence beside each claim.

```markdown
## Problem

The concrete trigger and user-visible result, the verified affected scope, and the cause.
Link the issue or user report. Label uncertainty instead of inventing a version range.

## Change

The resulting behavior and the relevant implementation decisions.

## Behaviour changes

What users and extension consumers can observe, including failure/cancellation paths.
Write "None" only after inspecting affected consumers.

## Evidence

- Revision/platform: final head, baseline, runtime/build identity and fixture.
- Scoped tests and task-appropriate control: command, result, intended assertion or invariant.
- App/UI: applicable scenario and independently observed outcome, or justified N/A.
- Performance: if applicable, production base/head runs, workload, spread and artifacts.
- `pnpm run verify`: exact-head result and clean tree afterward; concrete blockers if any.
- E2E: requested selection and comparable outcomes, or "not requested; outside this task's gates".
- CI: current state/link when available; distinguish test and infrastructure failures.

## Review

Independent review revision, findings and dispositions. Link evidence for contested claims.
State remaining blockers plainly.

## Not covered

Related work left outside the change, with an existing issue link where available.
Do not create or transition issues without authorization.

---

Written with [doodlebot](https://github.com/doodlum/vortex-doodlebot).
```

Every PR description ends with that footer. Additional tool attribution belongs above it.
`pr-preflight --pr` checks the title and section/footer format for an existing PR; branch
review can inspect a prepared description without opening one.

Use passed, failed, inconclusive, blocked or not applicable with a concrete reason. Do not
write an unexplained "Not run", conceal skipped coverage or describe earlier evidence as
rerun. Measurements belong in dated evidence, not hard-coded code comments. Update the
description and affected evidence when the head changes.

## Author and mechanical checks

Before implementation, identify affected callers, exported extension contracts, changed state
readers, success/failure/cancel/re-entry paths and observable behavior changes. Use
[knowledge routes](KNOWLEDGE-ROUTES.md) for specialist sources and relevant review lessons.
Write the task-appropriate control described in AGENT-WORKFLOW.md.

Run scoped tests and applicable `pr-preflight` before independent QA. It discovers potential
callers/readers/dispatchers, inspects size/comments/description and can revert selected
non-test changes for a negative control. Discovery is heuristic: manually inspect unrecognized
imports, indirect consumers and false matches. Give each meaningful warning a disposition.

A positive exit without the fix is a failed negative control. An import/setup/compile error
is inconclusive. When the reverted run fails, inspect the assertion and show it exercises the
reported mechanism; the command cannot decide that causal question. Use `--skip-revert` when
another task-appropriate control applies and explain why. Source mutation must be authorized,
and no app may be using that checkout during a revert check.

Classify useful findings as missing/mechanically missed checks, author omissions, newly
discovered reusable lessons, or judgment requiring independent review. These classifications
help improve prevention; fewer findings alone is not a quality metric. Keep uncertain lessons
in the task report and promote verified ones through the canonical workflow.

### Author brief

Fill in the canonical worker brief, then add Vortex-specific details:

```text
Implement <neutral issue> in <checkout>, owner <name>, base <sha/ref>.
User-authorized actions: <accurate scope, including commit/push/PR if granted>.
Excluded repositories/actions: <explicit constraints>.
Acceptance and affected contracts: <criteria and required evidence>.

Read the checkout's AGENTS.md, relevant nested instructions and docs index, plus the
applicable knowledge routes and review lessons. Establish the reproduction or acceptance
control, inspect consumers and exit paths, implement the smallest complete change and run
scoped checks. Use applicable preflight; disposition its warnings.

Use only your owned checkout/app/slot. Stop the app before rewriting checkout output.
Report the identified diff or actual commit, commands/results, controls, consumer/behavior
analysis, artifacts, remaining uncertainty and candidate kit lessons. Stop or explicitly
hand off the processes/resources you created. Publish only within the user's authorization.
```

## Independent review and QA

Start a fresh reviewer with `fork_turns="none"` or equivalent. Provide the neutral issue,
criteria, scope, exact revision and primary source entry points before the author's diagnosis.
Preserve relevant failed evidence and known constraints. Give driving QA its own checkout
and slot; read-only reviewers need neither. They may inspect but not edit the author's tree.

```text
Review <neutral issue> at head <sha or identified local diff>, base <sha>.
You did not author it. Allowed: read, scoped checks, and <authorized disposable app actions>.
No production edits or publication. Constraints: <scope, including any read-only checkout>.
Read the relevant repository instructions and AGENT-WORKFLOW.md report contract.

Independently inspect the actual diff and acceptance/gate applicability. Reproduce the issue
or acceptance behavior using a scenario derived from the task. Exercise affected consumers
and relevant cancellation, error, re-entry, data and UI boundaries. Use independent observations.
Run task-appropriate scoped checks/control; run app checks only where applicable and authorized.

Then compare author claims/artifacts at <path>. Verify the claimed mechanism, test-fake
constraints, current revision/runtime, selection/skips and prepared PR description.
Report confirmed findings with file:line and evidence, what held, and uncertainty. Do not pad
with hypothetical defects. Save the authorized report at <path>, or return it in chat if
writes are excluded. Include process/resource cleanup and candidate lessons.
```

Useful commands for an authorized Vortex review, with the reviewer's app stopped before
checks that rewrite output:

```powershell
pnpm run ai -- worktree add qa-topic --owner qa-topic --ref origin/<branch>
pnpm run ai -- up --owner qa-topic --worktree qa-topic --slot auto --sandbox
pnpm run ai -- down --owner qa-topic --worktree qa-topic --slot auto
pnpm run ai -- evidence run --owner qa-topic --checkout <qa-checkout> --base <base-sha> --out <new-evidence.json> -- pnpm run verify
pnpm run ai:preflight -- --owner qa-topic --checkout <qa-checkout> --base <base-sha>
```

Resolve confirmed findings, identify the resulting revision and renew affected QA. Verify that
test-only follow-ups really contain no production behavior change. Run expensive final gates
after scoped checks and review; do not keep restarting a reviewer while the design is changing.
Never release another worker's lease or take timings while another task occupies the machine.

Save authorized reports promptly and link them from the next brief. Transcripts are not a
knowledge base. A report needs concrete findings and evidence, not hidden model reasoning.
The accountable owner integrates changes and produces the final handoff.

## Review lessons

These historical cases are prompts to inspect the relevant current mechanism, not universal
requirements for every task. Promote new lessons only after verification and review. Correct
disproved guidance, remove obsolete workarounds and retain useful preventive tests. Link the
source incident and applicable source/test evidence rather than copying entire reports.

1. **Search every caller of a changed lifecycle path.** A shared component that gains a new
   update path changes behaviour for callers other than the one being fixed, including
   extensions. (#24281: `VisibilityProxy` re-observing broke `ConflictEditor`'s virtualisation.)
2. **List everything the change now passes somewhere new.** If you swap one value for another,
   list every consumer of that value before claiming nothing visible changes. (#24281: the scroll
   container also sets dropdown bounds.)
3. **A regression assertion must detect the claimed fix, including its wiring.** A test of only
   a new helper may miss an unconnected call site. For bugs, inspect the intended failure
   without the fix. Features/refactors use the task-appropriate control in AGENT-WORKFLOW.md.
   (#24281, #24282.)
4. **Fakes must enforce the real rule.** A stand-in that records calls without the constraint the
   real code applies passes broken orderings. (#24282: re-runs must be emitted after the hold is
   released.) A fake `IntersectionObserver` must report only changes, as the real one does. (visibility-proxy fix: a
   fake that re-reported on every call would have hidden the dropped-hide bug.)
5. **Release what you acquire on every exit path.** Early `return false`, a user Cancel, a throw
   and a pause. (#24282: the game-version Cancel leaked the suppression.)
6. **Evidence must exercise the claimed mechanism.** If a simpler part of the fix alone would
   produce the same result, the scenario proves only that part. (#24282: the re-run was never
   shown to matter in the app.)
7. **Qualify equivalence claims and generate adversarial inputs.** "Exactly equivalent" needs its
   domain, such as JSON-representable values. Property tests must generate `undefined`, `null`,
   nested and extra keys, arrays, and number against string. (#24283.)
8. **Check factual claims in the description, not just the code.** (#24282: "or the game is
   switched" was never true.)
9. **Report variance, not one run.** A/B numbers from a single run, or from runs under different
   harness overhead, need the number of runs and the spread. (#24283.)
10. **No measurements in code comments.** (#24284.)
11. **Make a performance fix fail without its wiring.** When the fix doesn't change behaviour, a
    "fails on the base" test is impossible, so count the work. Wrap the input in a counting `Proxy`,
    or count through the functions that copy it when it is rebuilt each pass, and assert reads,
    dispatches or calls per item. Only when neither can see the work, use a relative-timing test
    (N changed items against 1, fastest of several runs) and disclose it in the PR. A connected
    class component such as `SuperTable` can be tested without a store: mock the `ComponentEx`
    wrappers (`connect`, `extend`, `translate`) as identity functions and make `setState`
    commit synchronously. (#24283, #24284: `controls/table/calculatedValues.test.ts`.)
12. **Reviewers verify their own claims too.** Before saying a change "forces a render" or "throws",
    trace the guard that decides it. (#24284: `updateState`'s deep `_.isEqual` meant the unguarded
    copy cost O(n) but never rendered.)
13. **Check that related PRs combine.** When two open PRs touch the same code or behaviour, merge
    them without committing (`git merge --no-commit --no-ff <other>`, run the scoped suites, then
    `git merge --abort`), and say in each PR how they interact, including any conflict
    resolution. Also give new test files names that won't collide.
    (#24282 with the game-version Cancel fix: the merge was clean and the double release became a
    no-op. #24281 with #24284: both touch `Table.tsx`.)
14. **Render-path changes must keep unchanged items the same object.** When a change touches how
    derived state or rows are rebuilt, assert that unchanged items keep their reference (`toBe`),
    including when values are `null` or `undefined`, not just that the values are equal. QA then
    exercises every major consumer of the changed component, not only the one the fix is for.
    (#24284: a `null` column looked changed on every pass, so every Mods-page row got a new
    object, while the Plugins page, the fix's target, got faster.)
15. **Check a user-attributed root cause against the user's own data.** A plausible mechanism that
    reproduces in a hand-built fixture isn't the user's cause until their data shows the same
    shape. Inspect the relevant collection metadata and user-provided state only within
    the authorized scope. A user's `state.v2` is private user data, even when particular
    fields are not credentials; retain only the necessary redacted observations in reports. (#17: no optional in the user's collection shared a name with a
    required member, so the name clash couldn't be what they saw.)
16. **A fix that makes something laggy is not a fix.** Rendering work moved into a scroll or input
    handler (`flushSync` in `onRowsScroll`) pays for itself in every frame. Measure interaction
    on an idle machine before claiming the fix, and try it by hand. An author's "I can't tell on a
    shared CPU" is a blocker to resolve, not a caveat to ship. (#20: rows stayed drawn during a
    scrollbar drag, but the drag stepped at about 9 fps, and the user rejected it on first try.)
17. **Moving a control moves everything anchored to it.** A menu, submenu or tooltip placed
    relative to the moved control, with a flip when it doesn't fit, can open on another side. Open
    each one on the base and the head and compare their boxes before writing "nothing else
    changes". (#22: moving Profile left gave its Help submenu room to open right; on master it
    always flipped left.)
18. **A layout test pins the structure that makes the spacing, not just the order.** Mutate the
    markup the way a plausible mistake would (move an element out of its group, swap it with a
    divider, delete the divider) and check each makes the test fail. (#22: an order-only test
    passed all three.)
19. **When a stacked branch takes in a simplification, search its docs for what was dropped.**
    Code that the merge removes can still be described in the branch's own design notes. (#13
    after #22: `docs/design-system/panels.md` still described the outlined profile button.)
20. **Test a layout that shares space at its limits, and again after each fix.** Take it to the
    narrowest window and the highest zoom, with preview-only UI shown, in each account state
    (premium, free, signed out), and with longer and CJK stand-ins for its labels. A fix for one
    limit can move the problem to another. (#23: the controls covered the centered version at
    150% in a preview build; the first fix let translated labels wrap inside the bar; and a free
    account's wider Go premium made the Help submenu open to the other side.)
