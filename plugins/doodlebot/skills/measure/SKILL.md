---
name: measure
description: "Doodlebot: Measure a Vortex build on one of doodlebot's performance checks, run several times, and report medians and ranges; with a second build, run both alternately and give a rule-based verdict. Use for 'is it faster?' or 'did this make X slower?'."
argument-hint: "--a <build> [--b <build>] --check <check> [check options]"
disable-model-invocation: true
---

# Measure Vortex builds

You answer "how fast is X?" (one build, `--a`) or "is B slower or faster than A at X?" (two
builds, `--a` and `--b`) with one of doodlebot's performance checks, run several times, and a
deterministic summary. Without `--b` there is no verdict.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`);
   elsewhere `command -v doodlebot`.
4. Run `doodlebot status`. If MCP is `answering`, ask whether to stop the test Vortex (only one
   this session started) and run `doodlebot down` on a yes; otherwise stop. Ask the person to
   close heavy programs: the numbers are only as good as the machine's quiet conditions.

## 1. Pick the check

Map the question to one check (`--check`) and its options, and state the choice in one line
before running anything. Only these are supported; for anything else offer the nearest, or
decline.

| Check              | Measures                                                    | Content (need)       | Example options               |
| ------------------ | ----------------------------------------------------------- | -------------------- | ----------------------------- |
| `mods-scroll`      | Scrolling the Mods table with a real wheel                  | `--sandbox`          | `--mods 3000`                 |
| `large-library`    | Filtering, clearing, installing and deploying a big library | `--sandbox`          | `--mods 3000 --installs 10`   |
| `collection-scale` | Installing and updating a large offline collection          | `--sandbox`          | `--members 2000 --update`     |
| `download-churn`   | Persisting state while downloads churn                      | `--sandbox`          | `--downloads 20 --seconds 60` |
| `plugins-page`     | Scrolling, filtering and toggling the Plugins page          | `--bethesda-sandbox` | `--plugins 500`               |

For example, "the Mods table with 3,000 mods" is `doodlebot test mods-scroll --mods 3000`. The
content is the sandbox the check needs (`/doodlebot:try`'s content choice; both are always
ready); say so in the report's Builds section as "Tested against".

## 2. Fix the builds

A build is one of:

- a release version, `2.8.0`: `--release 2.8.0` (first `doodlebot release get 2.8.0` when
  `doodlebot release list` lacks it; a release without a published digest is Blocked);
- `--exe <path to Vortex.exe>`;
- a source checkout, `--dev-dir <dir>`, built first in production mode with
  `doodlebot build --checkout <dir> --production` (with the test Vortex stopped) and launched
  with `--dev-dir <dir> --production`, so it runs like a release.

Two source branches need two checkouts, one per build, never one checkout switched between
runs: `git -C <checkout> worktree add <dir> <branch>`, built each. After a build's first `up`,
confirm `automation_status.vortexVersion` is the version asked for; if not, stop and say so.

Give each build its own new cache folder, `<cache A>` (and `<cache B>`), for example
`<workspace>/harness/.cache/bench-<UTC time>-a`, and use that build's cache for every `up`,
`call`, check, `status` and `down` of that build. Agent shells do not keep environment
variables between calls, so set `VORTEX_AI_CACHE_DIR` (and, for a release or an executable,
the build's `VORTEX_AI_EXE` and `VORTEX_AI_INSTALLED`, below) inside each invocation, for
example `$env:VORTEX_AI_CACHE_DIR = '<cache A>'; doodlebot test …` in one PowerShell call, or
pass `--cache-dir <cache>` to `up`, `call`, `status` and `down`. A source build is named with
`--dev-dir <dir>` on every command, including `doodlebot test --dev-dir <dir> <check>`: no
environment variable selects a checkout.

Create the report folder `<workspace>/harness/.artifacts/benchmarks/<UTC time>-<slug>/` now.

**Tombstone each cache before its first `up`,** so the runs are anonymous and do not touch the
person's one shared Nexus login. Write this script once to the report folder as
`tombstone.mts`:

```ts
import fs from "node:fs";
import path from "node:path";
const kit = process.env.VORTEX_AI_KIT!;
const { loadConfig } = await import(new URL("./config.ts", kit).href);
const { authCacheFile } = await import(new URL("./instance.ts", kit).href);
const { usesSharedLogin } = await import(new URL("./login.ts", kit).href);
const config = loadConfig();
// The default cache uses the person's one shared login: a null there would sign them out.
if (usesSharedLogin(config)) throw new Error(`${config.cacheDir} uses the shared login`);
const file = authCacheFile(config);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, "null");
console.log(`tombstone: ${file}`);
console.log(`cacheDir: ${config.cacheDir}`);
console.log(`target: ${config.target.kind}`);
```

Select the build as `doodlebot script` takes it (it passes only `--dev-dir`, `--cache-dir` and
the port flags to the kit): a release or an executable sets `VORTEX_AI_EXE=<its Vortex.exe>`
(a release's is in `doodlebot release list --json`) and `VORTEX_AI_INSTALLED=1` in the
environment; a source checkout unsets both and passes `--dev-dir <dir>`. In the same invocation,
with `VORTEX_AI_CACHE_DIR` set to the build's cache, run
`doodlebot script <report folder>/tombstone.mts` (with `--dev-dir <dir>` for a source build). Check the printed `cacheDir` and `target`,
and keep the tombstone path for the report.

## 3. Run

Five runs per build by default, never fewer than three. With two builds, alternate them
(A, B, A, B, …). Keep each run's logs in the report folder.

Each run is these four steps, each with that build's cache (above):

1. `doodlebot up <build flags> <game flags> --fresh`, in the background with a log
   (`Start-Process -FilePath <shim> -ArgumentList <args> -RedirectStandardOutput <log> -RedirectStandardError <log>.err -NoNewWindow -PassThru`
   in PowerShell, `nohup <shim> <args> > <log> 2>&1 &` in Bash). The launch is done when that
   process has exited (`Get-Process -Id <pid>` or `kill -0 <pid>`) and its log has the line
   `Vortex is up in`; an exit without that line is a failed run. A cold start launches Vortex
   up to three times on the same port, so `doodlebot status` answering is only a liveness hint.
   Check the log's `target:` line names this build.
2. `doodlebot call automation_status`, recording `vortexVersion` and `nodeEnv`. A source
   build must show `production`.
3. `doodlebot test <check> <options>`, in the background with a log, waiting for it to exit.
   Capture its `evidence: <path>` line and its exit code.
4. `doodlebot down`.

Run outcomes:

- A run whose check exits 1 after writing evidence (a budget failure) counts, and its failures are listed.
- A run with no evidence is failed and not counted.
- A side with fewer than three counted runs makes the report _Blocked_.

## 4. Summarize

One build:

`doodlebot perf-summary --check <check> --a <file> --a <file> --a <file> --out <report folder>/report.md`

Two builds:

`doodlebot perf-summary --check <check> --a <file> --a <file> --a <file> --b <file> --b <file> --b <file> --out <report folder>/report.md`

It writes Results, Evidence and the statistical part of Caveats, and with `--b` also the
Verdict, printing the overall verdict and one line per metric. Then add the other sections to
`report.md`, in this order:

- **Question.** The person's question in their words.
- **Builds:** for each, the path, `vortexVersion` and mode (`nodeEnv`), its cache and
  tombstone, and the content used ("Tested against").
- **Measurement:** the command and options, and the number of runs per build.
- **Conditions:** the machine, the date, and what else was running.
- **Results:** a table per metric (from `perf-summary`).
- **Verdict:** only with `--b` (from `perf-summary`). With one build there is no Verdict
  section: there is nothing to compare with.
- **Evidence:** every run's JSON path, and any budget failures and failed runs.
- **Caveats.** `perf-summary`'s statistical caveat, and that the numbers are only as good as
  the machine's quiet conditions.
- **Learned:** lessons, kit gaps (`doodlebot gap add`) and catalogue entries proposed, or
  "nothing" (`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`). Never patch the doodlebot
  workspace mid-task.

The report's headings are:

```markdown
## Question

## Builds

## Measurement

## Conditions

## Results

## Verdict

## Evidence

## Caveats

## Learned
```

(leave out `## Verdict` for one build).

**Rerun rule.** When a build compared with itself, or a surprising result, gives a verdict
other than _No clear difference_, rerun the whole comparison once (new report folder, new
caches and tombstones) and report both results. With five runs a side, two sets from the same
distribution fail to overlap by chance in about 0.8% of cases per metric, about 4% across five
metrics.

## Finish

Tell the person a line per metric (median, minimum to maximum, counted runs; with two builds
both medians, the difference and its verdict, and the overall verdict first), any failed runs,
and the report's path. Leave no test Vortex running, and say the per-build caches can be
deleted.
