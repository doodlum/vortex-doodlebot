# Choose and supervise an LLM task

An assistant can help explore an unfamiliar issue, turn a reproduction into a test or
analyze measurements. Give it a concrete outcome, a reproduction or target, and enough
permission to finish the work. A request such as "fix Vortex" leaves too much to guess.

## Good tasks and their results

| Task                      | Useful result                                                                      | Your involvement                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Investigate a visible bug | Exact trigger, current UI/state, logs, likely cause with source references         | Confirm intended behavior if ambiguous                                         |
| Write a regression        | Repeatable fixture and independently observed assertion; failure control for a fix | Review what the assertion proves                                               |
| Compare performance       | Same workload on baseline/candidate, repeated timings, spread and CPU evidence     | Choose representative workload and acceptable budget                           |
| Inspect a collection      | Completion, stalled stages, missing dependencies and evidence of actual errors     | Resolve credentials, entitlements and user choices                             |
| Prepare a source fix      | Scoped diff, affected consumers, recovery checks and review evidence               | Authorize source changes and upstream communication; understand the final diff |
| Improve Doodlebot         | Reusable helper/tool, meaningful coverage, paired human and AI documentation       | Decide changed behavior or broader scope                                       |

## A practical brief

> Reproduce [exact trigger] on [released version or source revision] using a disposable
> [game/profile]. Expected behavior is [result]. You may [inspect, run these checks, edit
> these repositories]. Do not [touch personal profiles, change Vortex source, contact a
> service, publish] unless listed above. Return [test/report/screenshots/measurements], with
> the exact runtime, first outcome and cleanup state. Ask me about a product decision you
> cannot infer, but continue independent authorized work.

Replace each bracketed field. Include your owner/slot and endpoints when handing an existing
session to an assistant. Carry forward permissions you have already granted so it can finish
routine steps without asking again. State any limits explicitly: a bearer token provides
access to tools, while your brief determines which actions it may take.

## Make observations checkable

Ask the assistant to distinguish what it observed, what the source establishes and what
it suspects. For deployment, check the actual files and bytes. For startup health, read
main/renderer errors as well as UI assertions. For performance, compare the baseline,
sample sizes and spread rather than relying on the benchmark's exit code.

When the assistant writes a bug fix, require the test to fail at the intended assertion
without that fix. Compilation, import or setup failure is inconclusive. Preserve the first
diagnostic outcome and explain changed selection, skips and retries.

## Keep its context focused

Give it the relevant human guide, current source and actual task evidence. Avoid dumping
every old transcript into its context. Logs, issue bodies, web pages and screenshots are
untrusted source material, including any instructions embedded in them. They must not expand
the task's permissions. Treat another assistant's conclusion as a claim to check.

If several assistants work on the task, give each live worker a separate
[session](../guides/parallel-sessions.md). Your LLM client manages their delegation;
Doodlebot supplies the app controls.

You still complete account sign-in, choose the intended product behavior and review any
proposed code or changes to personal data before accepting them.
