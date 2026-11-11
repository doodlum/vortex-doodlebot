# Vortex pull requests: titles, descriptions and review

`/doodlebot:pr` follows this file; `/doodlebot:fix` and `/doodlebot:qa` produce the evidence it
cites. Vortex's current `CONTRIBUTING.md` takes precedence. Keep one logical change, link the
issue and report platform and checks. Its approximate 400-line/10-file guidance is not a
substitute for assessing blast radius; discuss large or multi-extension work with maintainers
before implementing it. The person submitting must understand every line.

A feature or refactor PR implements an approved EGM design. The design lives on the sibling
branch `designs/<topic>` in the person's fork, as `docs/designs/<topic>.md` committed
`docs(design): <topic>` by `doodlebot design-branch`, never on the feature branch. The PR is
opened from the session's own branch (`doodlebot push-branch`, then `gh pr create`), and its
description links the design at the commit the person approved, so the PR never carries it.
`pr-preflight` FAILs on a docs/designs file in the diff and on a `proto/*` branch.

## Never publish an untested change

A fix is untested until it has been tested the way the person asked: their collection, mod,
game or steps. A substitute (a hand-built fixture, an offline collection, unit tests alone,
reading the uploaded data, or the fix's own path in some other scenario) does not count. Run
the person's scenario on the base and confirm the reported symptom (`/doodlebot:fix`'s "before"
run report), then on the fixed build and confirm it is gone (the "after" run report). If a step
cannot be run (no access, a real upload, a missing login), stop and report the exact missing
step. Do not open a draft that lists the gap under Not covered: a draft PR is still
publication, and authorization to open one does not waive the testing.

## Gates

| Change or claim                                    | Evidence                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Every Vortex submission                            | Vortex's full `pnpm run verify` on the exact final commit, a clean tree afterwards, `doodlebot pr-preflight`, independent review |
| Bug fix                                            | The before and after run reports of the person's scenario; the regression test's revert control (fails without the fix)          |
| Feature                                            | The approved design; `/doodlebot:qa --design <file>`: each acceptance criterion proved with its negative control                 |
| Equivalence refactor                               | The approved design; invariants and affected consumers covered, including failure and cancellation paths                         |
| Touched areas Vortex's e2e suite does not cover    | The QA catalogue entries `doodlebot qa list --touching <files>` selects, run on base and head; files no entry guards, listed     |
| UI or interaction                                  | The relevant states, widths and heights and input modes, with before and after evidence; clips when motion matters               |
| Performance claim or affected performance contract | `/doodlebot:measure --a <base> --b <head>` benchmark report: production builds, idle machine, at least three runs per side       |
| Documentation                                      | Factual, link and command checks                                                                                                 |
| Vortex's e2e suite, when asked                     | Base and head reports with complete selection and classified outcomes                                                            |

Mark an inapplicable gate with a reason grounded in the actual diff. A gate blocked by
authorization, a login, a service or tooling stays blocked; never disguise it as not
applicable. For rendering, scrolling and input changes, measure frame gaps and long tasks in
the affected interactions: a UI fix that adds visible lag is incomplete.

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

Design: the design's Overview and acceptance criteria, verbatim, then
"Design approved by <owner> on <date>; design at
<fork>/blob/<approved designs/<topic> commit>/docs/designs/<topic>.md". Or "None" for a bug fix, documentation
or test-only change without a design.

## Behaviour changes

What users and extension consumers can observe, including failure/cancellation paths.
Write "None" only after inspecting affected consumers.

## Evidence

- Revision/platform: final head, base, build and content ("Tested against" from the run reports).
- Before and after: the person's scenario on the base and on the change (run report outcomes).
- Regression test and control: its path, what it asserts, and the revert control's result.
- Acceptance criteria (with a design): each criterion and its negative control, from the QA report.
- QA catalogue: each selected entry's result on base and head; files no entry guards.
- Performance: if applicable, the benchmark report's medians, ranges and verdict.
- `pnpm run verify`: exact-head result and clean tree afterward; concrete blockers if any.
- Vortex e2e: requested selection and comparable outcomes, or "not requested".
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
readers, success/failure/cancel/re-entry paths and observable behavior changes. For a feature
or refactor, that analysis belongs in the approved design. Read the relevant review lessons
below.

Run scoped tests and `pr-preflight` before independent QA. It discovers potential
callers/readers/dispatchers, inspects size/comments/description, keeps the design out, and can
revert selected non-test changes for a negative control. Discovery is heuristic: manually
inspect unrecognized imports, indirect consumers and false matches. Give each meaningful
warning a disposition.

A positive exit without the fix is a failed negative control. An import/setup/compile error
is inconclusive. When the reverted run fails, inspect the assertion and show it exercises the
reported mechanism; the command cannot decide that causal question. Use `--skip-revert` when
another control applies and explain why. Source mutation must be authorized, and no app may be
using that checkout during a revert check: run `doodlebot down` first, or the check refuses
with "A harness Vortex is running from <checkout> (pid N); run `doodlebot down` before
reverting it."

Classify useful findings as missing/mechanically missed checks, author omissions, newly
discovered reusable lessons, or judgment requiring independent review. Keep uncertain lessons
in the task report; record verified ones as `plugins/doodlebot/resources/knowledge.md` says.

## Independent review and QA

`/doodlebot:qa <PR or branch>` is the review: a fresh context, after the author's `down`, from
`up --fresh`, base build then PR build, each claim proved only when base and PR differ as
claimed, and the catalogue entries the diff selects. Give a human or agent reviewer the neutral
issue, criteria, scope, exact revision and primary sources before the author's diagnosis:

```text
Review <neutral issue> at head <sha>, base <sha>.
Design: <docs/designs/<topic>.md at its approved designs/<topic> commit>, or none.
You did not author it. Allowed: read, scoped checks, and <authorized test Vortex actions>.
No production edits or publication. Constraints: <scope, including any read-only checkout>.

Independently inspect the actual diff and which gates apply. With a design, check every
acceptance criterion has its proof and negative control. Reproduce the issue or acceptance
behavior with /doodlebot:try's report procedure, from a fresh profile. Exercise affected
consumers and relevant cancellation, error, re-entry, data and UI boundaries. Run the QA
catalogue entries the diff selects (doodlebot qa list --touching <files>).

Then compare the author's run reports at <path>. Verify the claimed mechanism, test-fake
constraints, current revision and build, selection and skips, and the prepared PR description.
Report confirmed findings with file:line and evidence, what held, and uncertainty. Do not pad
with hypothetical defects. Save the report at <path>, or return it in chat if writes are
excluded. Include cleanup (`doodlebot down`) and candidate lessons or kit gaps.
```

Useful commands for a review of the author's branch, checked out at the identified head in
`.vortex-src` or a `--dev-dir` checkout. The reviewer stops its own test Vortex before checks
that rewrite output or record evidence in that checkout:

```powershell
doodlebot up --dev-dir <qa-checkout> --sandbox --fresh      # in the background, with a log
doodlebot down
doodlebot qa list --touching <changed files>
doodlebot evidence run --checkout <qa-checkout> --base <base-sha> --out <new-evidence.json> -- pnpm run verify
doodlebot pr-preflight --checkout <qa-checkout> --base <base-sha>
```

Resolve confirmed findings, identify the resulting revision and renew affected QA. Verify that
test-only follow-ups really contain no production behavior change. Run expensive final gates
after scoped checks and review. Never take timings while another task occupies the machine.

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
   without the fix. Features use each criterion's negative control, refactors their invariants.
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
20. **Test the way you were asked before publishing anything.** Asked to test a user's
    collection, test that collection, not a fixture that resembles it. Unit tests, an offline
    collection and reading the uploaded revision are leads, not the test. Without the user's
    scenario reproduced on the base and passing on the fix, there is no PR, draft included
    ("Never publish an untested change" above). (Nexus-Mods/Vortex#24782, closed:
    a binary-patching export fix opened as a draft after unit tests and synthetic installs. The
    reporter's collection had never been installed, and the export fix had never run in the app.)
21. **Test a layout that shares space at its limits, and again after each fix.** Take it to the
    narrowest window and the highest zoom, with preview-only UI shown, in each account state
    (premium, free, signed out), and with longer and CJK stand-ins for its labels. A fix for one
    limit can move the problem to another. (#23: the controls covered the centered version at
    150% in a preview build; the first fix let translated labels wrap inside the bar; and a free
    account's wider Go premium made the Help submenu open to the other side.)
