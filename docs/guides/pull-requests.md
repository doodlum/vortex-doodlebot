# Open a pull request

This page shows how to have the agent check a Vortex branch and prepare its pull request with
`/doodlebot:pr`.

## Before you begin

- Have a committed branch of `<workspace>/.vortex-src` (or of the checkout you work in) with the
  change.
- Make sure the change was tested in the scenario it addresses. For a bug fix, the reported
  scenario was reproduced on the base and passes on the fix; see
  [Fix a Vortex bug](fix-a-bug.md#test-the-reported-scenario). Without that, the agent does not
  prepare a pull request, draft included.
- For a feature or a refactor, have the approved design; see [Design a feature](design-a-feature.md).
- Stop the test Vortex with `/doodlebot:stop`. The checks below refuse to change a checkout that
  a running test Vortex uses.

## Prepare the pull request

1. Run:

   ```text
   /doodlebot:pr
   ```

2. The agent runs `doodlebot pr-preflight` on the branch. It compares the committed branch with
   its merge base and reports PASS, WARN, FAIL or SKIP for each check:

   | Check                    | What it reports                                                             |
   | ------------------------ | --------------------------------------------------------------------------- |
   | Size                     | WARN over 400 changed lines or 10 files                                     |
   | Callers outside the diff | Uses of each changed export, member or helper outside the changed lines     |
   | Readers of changed state | Readers of each class field whose assignment changed                        |
   | Dispatchers of reducers  | Each changed reducer's action creator and its uses                          |
   | Revert check             | Whether the tests fail with the fix reverted, which shows they test the fix |
   | Measurements in comments | Timing or size figures in added comments                                    |

   The agent gives each meaningful warning a disposition.

3. The agent writes the description with these sections, in this order:

   - **Problem**: the trigger, the user-visible result, the affected scope and the cause, with
     the issue link.
   - **Change**: the resulting behavior and the relevant decisions, and the approved design
     with its digest, or "None" for a bug fix.
   - **Behaviour changes**: what users and extension authors can observe.
   - **Evidence**: revision and platform, design scope, scoped tests and controls, app
     checks, performance if relevant, and CI.
   - **Review**: the independent review and its findings.
   - **Not covered**: related work left out.

   Every description ends with the footer
   `Written with [doodlebot](https://github.com/doodlum/vortex-doodlebot).`

   The title follows Conventional Commits, such as `fix(collections): ...`, in under about 72
   characters.

4. The agent shows you the title and description. It never pushes a branch or opens a pull
   request unless you ask it to.

5. After you ask it to open the pull request, the agent runs `doodlebot pr-checks <number>` to
   report the pull request's CI checks, with failed jobs expanded to their failed steps.

The expected result: a preflight report, a description ready to post, and, once the pull request
exists, its check status.

## What's next

- Have the change checked independently with `/doodlebot:qa`; see
  [Drive Vortex and get a report](drive-vortex.md#check-a-change-independently).
- [Evidence and the QA catalogue](../concepts/evidence.md).
