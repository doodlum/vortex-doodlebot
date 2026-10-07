# Save test reports

A useful report lets someone else understand and repeat your check: what you tested, which
revision and app you used, how you set up the fixture, and what happened. Save failures and
measurements with those conditions. A command that exits successfully may still leave parts
of the workflow untested.

## Identify source and runtime separately

```powershell
pnpm run ai -- evidence identity --checkout 'C:\path\to\subject' --base '<baseline-ref>'
pnpm run ai -- evidence runtime --kind installed --label 'Vortex 2.8.0' 'C:\Apps\Vortex\Vortex.exe' 'C:\Apps\Vortex\resources\app.asar'
```

An identity records commit/diff hashes; a runtime identity records the files the app actually
used. Record the Doodlebot revision, the revision you are testing and the runtime separately.
Source hashes alone cannot establish that a binary was built from that source.

## Record an actual command

```powershell
pnpm run ai -- evidence run --owner verification --checkout 'C:\path\to\subject' --base '<baseline-ref>' --out 'C:\task\ci.json' -- pnpm run ci
```

Choose a new output path; existing reports are retained rather than overwritten. The report
captures execution, output, exit/signal, cancellation and before/after identities. Add
`--runtime runtime.json` for app checks. To record counts, use a newly produced reporter file
with `--test-report <json> --test-format vitest|playwright`. The structured reporter file
supplies counts that a plain log cannot.

For example, when the subject is this toolkit and the current directory is its root:

```powershell
pnpm run ai -- evidence run --owner verification --checkout . --base HEAD --out 'C:\task\unit.json' --test-report 'C:\task\vitest.json' --test-format vitest -- pnpm exec vitest run --reporter=json --outputFile='C:\task\vitest.json'
```

## Read outcomes honestly

- A nonzero command can fail in setup, import or the intended assertion; distinguish them.
- A skipped, empty or filtered selection cannot prove the omitted behavior works.
- Preserve the first failed run and explain a later retry, fixture change or correction.
- Benchmarks need comparable baseline/candidate workload and multiple runs, not just an exit code.
- Core Vortex logs must be checked for unrecoverable main and renderer errors before fixture cleanup.

## Readiness manifests

`readiness --manifest <json>` checks a report against the current versioned evidence schema,
including identities, required gates, controls and complete outcomes. `--json` returns the
report. You still need to run the checks and review what their results mean. Build the manifest
from actual task reports, using the implementation's exported schema and repository tests
for its format. See [helper reference](../reference/script-api.md) for execution helpers and the
[source schema](https://github.com/doodlum/vortex-doodlebot/blob/main/harness/src/readiness.ts)
for the complete manifest contract.
