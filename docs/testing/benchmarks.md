# Run the benchmark plan

The `benchmarks/` directory contains the proposal's case catalog, configuration, and runners. You do not need to write the whole plan yourself.

## List and check the catalog

```powershell
pnpm run benchmark:list
pnpm run benchmark:check
```

Listing shows each case's ID, name, and dataset. The catalog check verifies unique IDs and the expected coverage: 25 collection cases, 36 Mods actions, 40 game-table actions, 12 Downloads actions, and four background cases—**117 named cases**. Collections whose names are still TBD are excluded.

That is a catalog check, not an app test. A named case can still be blocked by missing data, controls, or account setup.

## Try one local smoke case

```powershell
pnpm run benchmark:smoke
```

The smoke runner selects `T1-scroll-150` and runs the real released Vortex with generated fake mod files and table records. It tests the UI without downloading Nexus mods. It needs no Nexus account, commercial game, or approved hardware profile.

Its exploratory manifest records the current CPU/RAM, Windows version, and temporary-workspace location. Vortex's runtime version and selected executable hash are captured in the SDK's evidence. Storage type and security settings are not audited by this convenience run. No timing budgets are supplied, and the result is labeled **exploratory smoke**, not an approved baseline.

The smoke output is under `harness/.artifacts/proposal-smoke`. Inspect `results.json` even when the runner exits unsuccessfully: it writes the report before throwing for blocked or failed cases.

## Run a prepared real collection

Run [guided setup](../getting-started/setup.md) to choose a pinned collection, verify a game snapshot and save the private login. After preparing C2, for example:

```powershell
pnpm run benchmark -- --exploratory --repeats=1 --timeout-minutes=360 --select=B1-C2
```

This performs genuine downloads and a cold install in a fresh working copy. It can take hours. The explicit six-hour operation timeout is not a performance budget. The runner loads the saved paths automatically, records available machine facts and writes a new timestamped result folder. It is exploratory, not an approved baseline.

`pnpm run setup -- --status` shows the saved choices without opening an app. Use `--status --verify` to recheck every snapshot. Additional custom cases remain ordinary TypeScript; see [adding a case](adding-benchmarks.md).

## Configure a formal run

Edit `benchmarks/config.ts`. Record the actual hardware, drive, bandwidth, account profile, Windows/security settings, and released installer version. Keep the proposal's unapproved selections and targets as TBD until the group agrees them.

Guided setup supplies the saved C1, C2, C2-AE, C3 and C5 collection choices. For custom fixtures or advanced overrides, configure the pinned revision, game, private OAuth cache, clean game copy, QA acknowledgement and readiness check. [Collection configuration](adding-benchmarks.md#collection-cases) explains those fields.

The default formal runner uses **three repeats** and a fresh app per repeat. Run selected cases first:

```powershell
pnpm run benchmark -- --select=T1-scroll-150,T3-filter-150
```

Run a chosen collection's cases after its prerequisites are ready:

```powershell
pnpm run benchmark -- --select=B1-C2,B2-C2,B3-C2,B4-C2,B5-C2
```

Run the full configured plan with `pnpm run benchmark`. The runner saves a separate report for each group under a timestamped proposal-benchmarks directory. Runs stay sequential so they do not compete for CPU, disk, or network.

The unattended real-collection runner requires Premium and automatically uses its ten download threads. The lower-level helper supports one thread for a free account, but that does not make this benchmark runner support unattended free downloads. You do not need to change the slider yourself. The report records the setting; Vortex may use the threads for chunks of a large file as well as separate files. Record your connection speed in the run profile too.

B1–B5 cover the four named collections, C1, C2, C3, and C5. The [proposal](proposal.md) describes their real collection matrix, including the two GTS variants and T1–T4.

Missing TBD inputs and game controls become blocked results. A successful synthetic list test does not cover a real collection or game-specific parser. A passed case without supplied budgets proves its defined action and assertions completed, not that a release target was met.

### GTS with and without paid Anniversary content

GTS revision 118 has two workloads. Keep their results separate:

| Configuration | Game snapshot                                                    | Optional members | Case IDs                  |
| ------------- | ---------------------------------------------------------------- | ---------------- | ------------------------- |
| C2            | Base Skyrim with the four free Creations; no paid Creation files | Skip             | B1-C2 through B5-C2       |
| C2-AE         | Skyrim with all paid Anniversary Upgrade Creations downloaded    | Install          | B1-C2-AE through B5-C2-AE |

Use `gtsCollection("base", paths)` or `gtsCollection("anniversary", paths)` to choose the matching policy. The helper pins the same revision for both. Add both entries to `configuration.collections` to run the full matrix; select `B1-C2,B1-C2-AE` for the two cold-install checks. Use different snapshot and output folders and run sequentially. [Cache both snapshots from one Steam installation](adding-benchmarks.md#collection-cases) with `createSkyrimSnapshot()`: its base copy omits paid files automatically, and its Anniversary copy retains them. Steam is left untouched.

Before launching Vortex, the SDK rejects paid Creation files in a base snapshot. For Anniversary, it requires the 74 Creation plugins listed by stock Steam Skyrim and each plugin's nonempty main BSA archive. This checks the installed inventory; the snapshot manifest checks that every copied file retains its original bytes. Finish Skyrim's own purchased-content download before caching the AE snapshot. File presence alone cannot prove a partial download is genuine or that the game will launch.

The install records a skip/select choice for every optional rule and reapplies it if Vortex refreshes the collection metadata. The AE case also waits for all selected optional members to be installed and enabled. Both cases then check the stock completion screen, deployment and game-specific readiness. Required members cannot be skipped to obtain a pass.

When the collection manifest arrives, Vortex opens its installation flow automatically. Doodlebot waits for that exact collection's driver and confirms Install Now only at its query step. It starts an existing manifest once when the driver is idle. It does not send a second start command to an active driver, dismiss an “Already installing” warning or operate another collection's controls. If the driver cannot be observed, the run fails with its evidence retained.

### When the collection looks paused after installing

The real collection benchmark checks both the required mods and the collection screen. It keeps answering supported installation dialogs until the install driver finishes its review and post-processing. The visible installation progress panel must then disappear; the check allows up to 30 seconds for that final render, within the installation timeout. Keep that collection page open while `addCollection()` runs.

If Vortex reports a finished driver but still shows “Waiting to install” or a Resume button, the run fails its UI completion check. Its evidence records the driver state and the panel's member counts. Required members must finish, and optional members must follow the chosen case.

An unreadable driver or an unsupported collection view produces a blocked result. Finished downloads, satisfied mod rules, and a deployed game are separate checks; none alone proves the whole installation workflow finished cleanly. Game launch remains outside these benchmarks.

## Restart a real collection from scratch

Close the game and finish or stop the previous benchmark first. Use a verified [game snapshot](adding-benchmarks.md#collection-cases) and a new output folder:

```typescript title="restart-collection.mts"
import fs from "node:fs";
import path from "node:path";
import { restartCollectionBenchmark } from "./harness/benchmarks/index";
import { exploratoryManifest } from "./benchmarks/config";
import { gtsCollection } from "./benchmarks/collections";

const machine = exploratoryManifest();
const outputDir = "harness/.artifacts/gts-clean-restart";
const manifest = {
  ...machine,
  profile: { ...machine.profile, account: "premium" as const },
  collection: gtsCollection("base", {
    authCache: "harness/.cache/your-private-oauth-cache.json",
    gameFixture: "harness/.artifacts/game-fixtures/skyrim-base",
    allowGameFixtureCopy: true,
    dedicatedWindowsAccount: true,
    ready: { gameFiles: ["SkyrimSE.exe", "Data/Skyrim.esm", "skse64_loader.exe"], equals: true },
  }),
};

await restartCollectionBenchmark({ manifest, outputDir }, async (vortex) => {
  await vortex.collectionMeasure(async () => {
    await vortex.addCollection();
    await vortex.deploy();
  });
  await vortex.verifyReady();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "evidence.json"),
    JSON.stringify(
      {
        scope: "One exploratory cold install; no approved baseline",
        measurements: vortex.measurements,
        evidence: vortex.evidence,
      },
      null,
      2,
    ),
  );
});
```

Replace the OAuth path with the private cache from login setup. Run `pnpm exec tsx restart-collection.mts`. C2's revision comes from the checked-in pin. This performs real Nexus downloads and installs the collection into a fresh copy of the real game; it can take hours and needs space for archives, staging and deployment.

The restart checks every snapshot file, creates a new Vortex profile with an empty download cache, and sets maximum download threads before the clock starts. Old modded game copies and failed-run evidence stay separate. It does not repair or overwrite the Steam installation. A dirty snapshot is rejected; make a fresh snapshot from a known clean installation instead.

On the QA account, Skyrim's INIs, their `.base`/`.baked` copies, `Plugins.txt` and `loadorder.txt` are backed up and checked before removal. Saves and `ContentCatalog.txt` stay in place. Cyberpunk's reset covers `UserSettings.json`. Other games need a reset adapter before a clean restart is supported. Backups remain in `outputDir/game-settings-backups`, with `backup.json` recording their original locations. They are private recovery files. The reset remains in effect after the run; to recover old settings, close Vortex and the game and copy the backed-up files to those recorded locations.

An existing session can be passed as `previous` after its work has settled; restart closes it and retains its workspace. Another running real benchmark for the same account/game blocks the restart. To reset settings for each real repeat in `runBenchmarks()`, add `cleanStart: true` to its options.

## Pause and resume downloads

While a real collection is installing, the session exposes `pauseDownloads()` and `resumeDownloads()`. For example, an application can call these from its Pause and Resume controls:

```typescript
import type { BenchmarkSession } from "./harness/benchmarks/index";

export async function pauseUntilResume(
  vortex: BenchmarkSession,
  waitForResume: () => Promise<void>,
): Promise<void> {
  const progress = await vortex.downloadProgress();
  console.log(progress.active, progress.paused, progress.finished, progress.receivedBytes);
  await vortex.pauseDownloads();
  // Returns after scheduling has stopped and no download bytes are growing.
  try {
    await waitForResume(); // Your application's Resume control.
  } finally {
    await vortex.resumeDownloads();
  }
}
```

An automated control can poll `downloadProgress()` until `active > 0` before testing Pause. `receivedBytes` counts the bytes reported by Vortex, including partial transfers; it is not an estimate of the final collection size.

Pause controls the exclusively owned benchmark profile's whole download queue. Resume starts the collection's own driver with the account's maximum download threads. It does not mean the collection has finished: keep awaiting the original `addCollection()` operation. A paused install still has its original timeout. Keep pause/resume outside timed baseline runs; this control does not silently subtract the pause from a measurement.

The restart promise also includes teardown checks. Treat the operation as successful only when that promise resolves. For failures before the callback, catch the returned promise and save its error message; the error includes the retained workspace location. Inside the callback, a `finally` block can save partial measurements and evidence if installation fails.

## Write a small standalone benchmark

To learn the API or add a new case, use `defineBenchmark()` and `runBenchmarks()`. This exploratory manifest provides actual machine metadata without inventing an approved profile:

```typescript title="exploratory-config.ts"
import os from "node:os";
import path from "node:path";
import type { RunManifest } from "./harness/benchmarks/index";

export const exploratoryManifest: RunManifest = {
  profile: {
    hardware: `${os.cpus()[0]?.model}; ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM; exploratory machine`,
    storage: `Temporary workspace: ${os.tmpdir()}; volume ${path.parse(os.tmpdir()).root}; drive class not audited`,
    bandwidth: "n/a: local synthetic data",
    account: "anonymous",
    osSecurity: `${os.type()} ${os.release()}; security settings not audited for exploratory smoke`,
    vortexBuild:
      "Auto-located released Vortex; runtime version and executable hash recorded in evidence",
  },
  synthetic: { count: 150, filesPerMod: 3 },
};
```

```typescript title="exploratory-smoke.mts"
import { defineBenchmark, runBenchmarks } from "./harness/benchmarks/index";
import { exploratoryManifest } from "./exploratory-config";

const scroll = defineBenchmark({
  id: "T1-scroll-150",
  name: "Scroll 150 synthetic Mods rows",
  dataset: "synthetic",
  async run(vortex) {
    await vortex.seedMods(150);
    await vortex.table("mods").scroll();
  },
});

await runBenchmarks({
  benchmarks: [scroll],
  manifest: exploratoryManifest,
  repeats: 1,
  outputDir: "harness/.artifacts/exploratory-smoke",
});
```

Run `pnpm exec tsx exploratory-smoke.mts`. Scroll uses real wheel input and checks that the viewport moves and visible rows contain rendered cells. There is no network download.

For a formal comparison, replace this convenience profile with recorded drive type, security settings, installer version, and agreed run conditions. The group still owns hardware-profile and budget decisions.

## Continue after a blocked group

### Collection install failures

Doodlebot records collection warnings without retrying, skipping failed members or dismissing errors. With warnings allowed, a collection can pass only after Vortex reports it fully installed and the final member, UI, deployment and game-file checks succeed. An unresolved failed member always fails the case, including a selected Anniversary optional.

“Collection installation incomplete” ends the attempt as a failure as soon as Doodlebot observes that review heading for the pinned collection. Mentioning those words in a mod name or below a successful review heading does not fail the case. Doodlebot does not wait for the overall timeout or click through the failure. Failed selected optional members also fail once Vortex has finished their installation round. A temporary download warning can still pass if Vortex recovers and the final checks succeed.

Selected optionals get one installation round. Doodlebot checks the collection's own review state before answering the completion dialog. If selected members remain unsatisfied after that round, it leaves the review open: an observed native failure ends the case, and an unresolved state reaches the case timeout. It never clicks **Install optional mods** again or **Done** to get past that state.

Satisfied mod counts do not override remaining failures in the active collection session or its downloads. Doodlebot checks those records before dismissing the completion dialog and again after the final functional checks.

Startup cases check functional readiness before and after restarting Vortex. Those checks are outside the startup timing window.

The current collection benchmark cases allow warnings and retain them in the results. A pass still requires a fully installed, functional collection. The choice is recorded in the install evidence. To make a case fail on any warning:

```typescript
const collection = gtsCollection("base", machinePaths);
collection.warningsAsErrors = true; // opt into strict warnings
```

`realCollection()` and `gtsCollection()` set `warningsAsErrors: false` unless you override it in the machine configuration. A manifest written directly for the SDK defaults to strict warnings when the option is omitted. Both policies check final readiness and keep every warning. The lower-level `installCollection()` helper defaults to allowing warnings, but requires a `verifyCompletion` callback that checks the final functional and UI state before accepting them; member counts alone are insufficient. Pass `{ warningsAsErrors: true }` to make it strict. Failed automation actions remain errors and are never retried.

Successful samples can repeat for a performance comparison. The runner stops repeating a case when it fails or is blocked; a later successful run cannot replace that result.

A case written specifically to test retry behaviour can make another attempt explicitly. Record each attempt and its failure in `vortex.evidence`, then assert the expected behaviour. Each failed `vortex.addCollection()` call also adds a failure entry before throwing. Ordinary install cases let that error fail the case.

If timing events are lost, installation verification can finish, but the benchmark is blocked and publishes no collection timings. The result records the timing problem separately from install errors.

`runBenchmarks()` writes its report, then throws if any case failed or was blocked. A runner that wants reports for several independently configured groups should catch each invocation and finish the remaining groups:

```typescript
let incomplete = false;
for (const group of catalog) {
  try {
    await runBenchmarks({
      benchmarks: group.cases,
      manifest: group.manifest,
      outputDir: `harness/.artifacts/my-run/${group.id}`,
    });
  } catch (error) {
    incomplete = true;
    console.error(group.id, error);
  }
}
if (incomplete) process.exitCode = 1;
```

This preserves each group's reason and reports without presenting an incomplete run as successful.

Continue with [adding a case](adding-benchmarks.md), [reading reports](results.md), or [troubleshooting](../troubleshooting.md).
