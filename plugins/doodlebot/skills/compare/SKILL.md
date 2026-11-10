---
name: compare
description: "Doodlebot: Compare two Vortex builds on one of doodlebot's performance checks, run alternately five times each, and report medians, ranges and a rule-based verdict; use for questions like is my branch slower than 2.8.0."
argument-hint: "<build A> <build B> <what to measure, e.g. the Mods table with 3,000 mods>"
disable-model-invocation: true
---

# Compare two Vortex builds

You answer "is build B slower or faster than build A at X?" with one of doodlebot's
performance checks, run on both builds alternately, and a deterministic summary. Nothing is
downloaded or installed: the person names each build.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`);
   elsewhere `command -v doodlebot`.
4. Run `doodlebot status`. If MCP is `answering`, ask whether to stop the test Vortex and
   run `doodlebot down` on a yes; otherwise stop. Ask the person to close heavy programs:
   the verdict is only as good as the machine's quiet conditions.

## 1. Pick the check

Map "what" to one of the five checks and its options, and state the choice in one line
before running anything. Only these are supported; for anything else offer the nearest
check, or decline.

| Check              | Measures                                                    | Game flags           | Example options                      |
| ------------------ | ----------------------------------------------------------- | -------------------- | ------------------------------------ |
| `mods-scroll`      | Scrolling the Mods table with a real wheel                  | `--sandbox`          | `--mods 3000`                        |
| `large-library`    | Filtering, clearing, installing and deploying a big library | `--sandbox`          | `--mods 3000 --installs 10`          |
| `collection-scale` | Installing and updating a large offline collection          | `--sandbox`          | `--members 2000 --update`            |
| `download-churn`   | Persisting state while downloads churn                      | `--sandbox`          | `--downloads 20 --seconds 60`        |
| `plugins-page`     | Scrolling, filtering and toggling the Plugins page          | `--bethesda-sandbox` | `--plugins 500` (source builds only) |

For example, "the Mods table with 3,000 mods" is `doodlebot test mods-scroll --mods 3000`.

## 2. Fix the builds

A build is the installed Vortex (`--installed`), an executable (`--exe <path>`) or a source
checkout (`--dev-dir <path>`).

- A release version, such as "2.8.0": the installed Vortex (`--installed`) when that is the
  version installed, otherwise `--exe <path to that release's Vortex.exe>` (ask the person
  where it is). After its first `up`, confirm `automation_status.vortexVersion` is that
  version; if it is not, stop and tell the person.
- An executable: use `--exe <path to Vortex.exe>`.
- A source checkout: build it in production mode first with
  `doodlebot build --checkout <dir> --production` (stop the test Vortex first), and launch
  it with `--dev-dir <dir> --production`, so it runs like a release.
- Two source branches need two checkouts, one per build, never one `<workspace>/.vortex-src` switched
  between runs: a second clone, or `git -C <checkout> worktree add <dir> <branch>`. Build
  each one.
- `plugins-page` needs source builds on both sides.

Give each build its own new cache folder, `<cache A>` and `<cache B>`, for example
`<workspace>/harness/.cache/bench-<UTC time>-a`, and use that build's cache for every `up`,
`call`, check, `status` and `down` of that build. Baselines are keyed by target kind, so two
builds of the same kind would otherwise share one. Agent shells do not keep environment
variables from one call to the next, so set `VORTEX_AI_CACHE_DIR` (and the build's
`VORTEX_AI_EXE`, `VORTEX_AI_INSTALLED` or `VORTEX_AI_DEV_DIR`, below) inside each
invocation, for example `$env:VORTEX_AI_CACHE_DIR = '<cache A>'; doodlebot test …` in one
PowerShell call or `VORTEX_AI_CACHE_DIR=<cache A> doodlebot test …` in Bash, or pass
`--cache-dir <cache>` to `up`, `call`, `status` and `down`.

Create the report folder `<workspace>/harness/.artifacts/benchmarks/<UTC time>-<slug>/` now.

**Tombstone each cache before its first `up`,** so benchmark runs are anonymous and do not
inherit the person's Nexus login. Write this script once to the report folder as
`tombstone.mts`:

```ts
import fs from "node:fs";
import path from "node:path";
const kit = process.env.VORTEX_AI_KIT!;
const { loadConfig } = await import(new URL("./config.ts", kit).href);
const { authCacheFile } = await import(new URL("./instance.ts", kit).href);
const config = loadConfig();
const file = authCacheFile(config);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, "null");
console.log(`tombstone: ${file}`);
console.log(`cacheDir: ${config.cacheDir}`);
console.log(`target: ${config.target.kind}`);
```

Then select the build through the environment, because `doodlebot script` passes only
`--dev-dir`, `--cache-dir` and the port flags to the kit: for the installed Vortex
(`--installed`) set only `VORTEX_AI_INSTALLED=1`; for an executable set
`VORTEX_AI_EXE=<path>` and `VORTEX_AI_INSTALLED=1`; for a source checkout set
`VORTEX_AI_DEV_DIR=<path>` and unset both. In the same invocation, with
`VORTEX_AI_CACHE_DIR` set to the build's cache too, run
`doodlebot script <report folder>/tombstone.mts`. Check that the printed `cacheDir` is that
cache and `target` is the build's kind, and keep the tombstone path for the report.

## 3. Run alternately

Run A and B alternately (A, B, A, B, …), five times each by default and never fewer than
three. Keep each run's logs in the report folder.

Each run is these four steps, each with that build's cache (above):

1. `doodlebot up <build flags> <game flags> --fresh`, in the background with a log
   (`Start-Process -FilePath <shim> -ArgumentList <args> -RedirectStandardOutput <log> -RedirectStandardError <log>.err -NoNewWindow -PassThru`
   in PowerShell, `nohup <shim> <args> > <log> 2>&1 &` in Bash). The launch is done when
   that process has exited (check its pid with `Get-Process -Id <pid>` or `kill -0 <pid>`)
   and its log has the line `Vortex is up in`; an exit without that line is a failed run. A cold start launches Vortex up to three times on the same
   port, so `doodlebot status` answering is only a liveness hint, not completion. Check the
   `target:` line in the log names this build.
2. `doodlebot call automation_status`, recording `vortexVersion` and `nodeEnv`. A source
   build must show `production`.
3. `doodlebot test <check> <options>`, in the background with a log, waiting for it to
   exit. Capture its `evidence: <path>` line and its exit code.
4. `doodlebot down`.

Run outcomes:

- A run whose check exits 1 after writing evidence (a budget failure) counts, and its failures are listed.
- A run with no evidence is failed and not counted.
- A side with fewer than three counted runs makes the report _Blocked_.

## 4. Summarize

Run, with one evidence file per repeated `--a` or `--b`:

`doodlebot perf-summary --check <check> --a <file> --a <file> --a <file> --b <file> --b <file> --b <file> --out <report folder>/report.md`

It writes Results, Verdict, Evidence and the statistical part of Caveats, and prints the
overall verdict, then one line per metric with its verdict and medians. Then add the other
sections to `report.md`, so it has, in this order:

- **Question.** The person's question in their words.
- **Builds:** for A and B, the path, `vortexVersion` and mode (`nodeEnv`), and its cache and
  tombstone.
- **Measurement:** the command and options, and the number of runs per side.
- **Conditions:** the machine, the date, and what else was running.
- **Results:** a table per metric (from `perf-summary`).
- **Verdict.** (from `perf-summary`)
- **Evidence:** every run's JSON path, and any budget failures (from `perf-summary`, plus
  the runs that failed without evidence).
- **Caveats.** `perf-summary`'s statistical caveat, and that a verdict is only as good as
  the machine's quiet conditions.

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
```

**Rerun rule.** When a build compared with itself, or a surprising result, gives a verdict
other than _No clear difference_, rerun the whole comparison once (new report folder, new
caches and tombstones) and report both results. With five runs a side, two sets from the
same distribution fail to overlap by chance in about 0.8% of cases per metric, about 4%
across five metrics.

## Finish

Tell the person the overall verdict, then a line per metric (median A, median B, the
difference and its verdict), the number of counted runs per side, any failed runs, and the
report's path. Leave no test Vortex running, and say the per-build caches can be deleted.
