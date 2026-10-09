# Add a case or configuration

Keep cases as normal TypeScript modules. Each case needs a stable ID, a readable name, a dataset label, and a function that performs and verifies the work. The runner handles app lifetime and repeat reports.

The supplied catalog is in `benchmarks/`. Start by editing its `config.ts` and running the selected IDs through `run.mts`. Use `smoke.mts` for a one-repeat local trial and `check-catalog.mts` for coverage structure. The recipes below show how its case functions and workload configuration fit together when you add or change coverage.

## A small custom case

This example measures filtering a generated list through its visible search field:

```typescript title="custom-case.ts"
import { expect } from "@playwright/test";
import { defineBenchmark } from "./harness/benchmarks/index";

export const search = defineBenchmark({
  id: "T1-search-570",
  name: "Search 570 synthetic Mods rows",
  dataset: "synthetic",
  async run(vortex) {
    await vortex.seedMods(570);
    await vortex.openPage("Mods");
    await vortex.measure("search.no-results", async () => {
      await vortex.page.locator("#table-mods .header-name input").fill("no-matching-mod");
      await expect(vortex.page.locator("#table-mods tr[data-rowid]")).toHaveCount(0);
    });
  },
});
```

Import `search` into your runner script and put it in `benchmarks: [search]`. The setup happens outside `measure()`. The timed section includes the action, the assertion, and the final paint.

Repeated measurement names receive numbered suffixes, such as `mods.search.2`. Keep the same action sequence across repeats so the measurement names stay comparable. Do not wrap table action helpers in `measure()`: they already measure the action.

## Choose counts

`sizes` exports the proposal's candidate counts, **150, 570, 1,594, 2,685**. To create one case per size:

```typescript title="scroll-cases.ts"
import { defineBenchmark, sizes } from "./harness/benchmarks/index";

export const scrollCases = sizes.map((count) =>
  defineBenchmark({
    id: `T1-scroll-${count}`,
    name: `Scroll ${count} synthetic Mods rows`,
    dataset: "synthetic",
    async run(vortex) {
      await vortex.seedMods(count);
      await vortex.table("mods").scroll();
    },
  }),
);
```

The count is a fixture choice, not a pass/fail limit. `filesPerMod` changes deployment workload and must stay fixed for a comparison.

## Table actions and outcomes

Use `table("mods")` or `table("downloads")` for local lists. For game-specific tables, configure `manifest.tables.plugins` or `manifest.tables["load-order"]` and use real installed data.

For common Mods actions, the helpers discover the released app's controls and verify their consequences:

```typescript
const mods = vortex.table("mods");
await mods.sort("name");
await mods.group("status");
await mods.ungroup();
await mods.disable([modIds[0]!]);
await mods.enable([modIds[0]!]);
await mods.selectAll();
```

`modIds` comes from `seedMods()`. Newly seeded mods are enabled, so disable one before testing enable. Simple sorting supports the `name` and `filename` columns: it checks the complete order and confirms that each row keeps its original ID and text. For other columns, supply an explicit order expectation. Grouping must produce headings; selection must include every row. A missing control becomes a blocked case with a reason.

Before timing a simple sort, the helper reads names across the list and establishes an initial order. This setup warms row rendering. It then times reversing the order and painting visible rows. Use a separate case to measure the first rendering of untouched rows.

`search("query")` and `filter("enabled")` are also available. A search must change the matching rows. An enabled/disabled filter needs a mixture of both states in the fixture, otherwise it cannot prove a filtering effect. Clear a search with `search("")`, or reset a status filter with `filter("all")`; these are separately measured actions.

An advanced action supplies its actual control and the expected effect:

```typescript
await vortex.table("mods").search({
  control: "#table-mods .header-name input",
  value: "no-matching-mod",
  expect: { selector: "#table-mods tr[data-rowid]", read: "count", equals: 0 },
});
```

`control` identifies one visible enabled input or button. `expect` reads a DOM value or a Vortex state path after the action. Its value must change from the starting value: an already-satisfied expectation is blocked as a no-op.

For sort, observe row order; for group/ungroup, observe group headings; for enable/disable, observe the affected mod's state; for select all, observe the selection; for drag, observe the new order. A click that returns successfully is insufficient.

Use the table's `sort`, `group`, `ungroup`, `search`, `filter`, `enable`, `disable`, `selectAll`, `drag`, and `scroll` methods for the [proposal action lists](proposal.md#table-responsiveness). Game-specific controls must come from the page you are testing. If a control or required data is missing, call `vortex.block("reason")` or let the helper report the missing prerequisite.

A table definition supplies `page` (its visible navigation label), `root`, `rows`, and `scroller` (CSS selectors). Startup's Mods usability check also needs `search`. The scroller must be the actual scrollable element.

## Collection cases

For the supplied collections, run [guided setup](../getting-started/setup.md) first, then load the saved configuration with `preparedCollection("C2")` from `./benchmarks/setup`. It finds the Steam game, manages the private login path and verifies reusable snapshots. You do not need to transcribe those paths into `benchmarks/config.ts`.

For a custom collection or store, a directly written manifest needs:

- `url`: a Nexus collection URL ending in `/revisions/<number>`.
- `engine`, `gameId`, and `expectedMods`: the confirmed pinned collection identity.
- `authCache`: your private cached OAuth file.
- `gameFixture`: a test game installation to copy into the disposable workspace.
- `allowGameFixtureCopy: true`: explicit use of that copy for mod installation and deployment.
- `dedicatedWindowsAccount: true`: confirmation that the run uses a QA-only Windows account or test machine.
- `ready`: an observable game-specific readiness condition after deployment.

Complete [login setup](../getting-started/authentication.md) first. The unattended runner requires a Premium account. Run real game cases in a QA-only Windows account or test machine: game-support extensions may write that account's Documents and LocalAppData even though Vortex's profile and the copied game are isolated. Set `dedicatedWindowsAccount: true` only when that condition is met. A [clean restart](benchmarks.md#restart-a-real-collection-from-scratch) also backs up and resets supported game settings.

An installed Steam game is a valid source fixture. Guided setup discovers supported Steam games. For a custom source it cannot locate, use Steam’s **Manage → Browse local files** and supply that directory. Wait for Steam's installation and updates to finish first. The runner copies these real game files into its test workspace; it needs enough disk space for that copy as well as the collection downloads and staging files.

If Skyrim needs to download your Anniversary creations on first launch, finish that download and close the game before making a reusable snapshot. Keep the clean snapshot separate from any collection's installed game copy. This small script caches the real game files once:

```typescript title="cache-steam-game.mts"
import { createSkyrimSnapshot } from "./harness/benchmarks/index";

import { discoverBenchmarkGames } from "./benchmarks/setup";

const source = discoverBenchmarkGames().find((game) => game.id === "skyrimse")?.directory;
if (!source) throw new Error("Install Skyrim in Steam or use guided setup with another directory.");
await createSkyrimSnapshot({
  source,
  destination: "harness/.artifacts/game-fixtures/skyrim-base",
  edition: "base",
});
await createSkyrimSnapshot({
  source,
  destination: "harness/.artifacts/game-fixtures/skyrim-ae",
  edition: "anniversary",
});
```

Run `pnpm exec tsx cache-steam-game.mts` from the repository root. Use the corresponding destination as `gameFixture`. The base copy omits paid Creation files and keeps the four free Creations. The AE copy keeps the purchased files and rejects an incomplete plugin/main-archive inventory before copying. Both leave Steam untouched and refuse an existing destination. If you only need the base case, omit the second call; the base copy can be made while the source still has only some paid content, once the game is closed. Switching between clean snapshots means changing that one field; each benchmark gets its own working copy. Apply a collection's required downgrade to a separate prepared snapshot, and retain the original Steam snapshot. Never cache a game folder that already contains deployed collection mods.

This game snapshot contains the game and its purchased content. It is separate from B2's archive cache, which contains genuine downloaded collection members. B2 fills that archive cache before starting its install clock.

The helper hashes every file, checks the copied bytes, and writes a manifest beside the snapshot. Each use checks that manifest for missing, extra, or changed files. Linked files and Vortex deployment manifests are rejected. Start with an installation you know is clean: matching hashes do not establish that a modded source is a genuine Steam installation.

If the copy fails, its destination may contain only some files and has no completed manifest. Resolve the copy error and choose a new destination. For other games or custom omissions, `createGameSnapshot()` accepts `exclude: ["Data/example.esl"]` with exact relative paths; the snapshot records the exclusions. Do not label a snapshot containing only some paid creations as a complete Anniversary installation.

Before using a Skyrim snapshot, check the executable's version and the pinned curator's requirements. The pinned I&A revision accepts Steam 1.7.104 and supplies its own automatic downgrade; Gate to Sovngarde has two workloads: current Steam with only the free Creations, or current Steam with the complete paid Anniversary content. Their optional-mod policies differ. Constellations requires those creations and its specified downgrade in a separate prepared snapshot. Keep these checks outside the timed collection install.

Account access, available downloads, the game installation, and a suitable QA account remain prerequisites. Without the account confirmation, real cases are blocked before launch.

This example uses the paid Anniversary variant prepared by guided setup. For the base variant, load `preparedCollection("C2")` and use IDs B1-C2 through B5-C2. See [the two GTS workloads](benchmarks.md#gts-with-and-without-paid-anniversary-content). The machine profile is exploratory; it does not approve a release baseline.

```typescript title="collection-config.ts"
import type { RealRunManifest } from "./benchmarks/types";
import { exploratoryManifest } from "./benchmarks/config";
import { preparedCollection } from "./benchmarks/setup";

const machine = exploratoryManifest();
export const collectionManifest: RealRunManifest = {
  ...machine,
  timeoutMs: 4 * 60 * 60 * 1000,
  profile: {
    ...machine.profile,
    account: "premium",
    bandwidth: "Unthrottled exploratory connection; record your actual run conditions",
  },
  collection: preparedCollection("C2-AE"),
};
```

[Guided setup](../getting-started/setup.md) saves the private login-cache path with the collection choice. The SDK saves refreshed credentials back to that private file after Vortex exits. Run collections sequentially with that login; the SDK blocks overlapping use of its cache.

`gameFiles` checks actual regular files under the copied game. Readiness also requires the exact pinned collection, all its required members, no ignored required members, no running installers, and completed deployment with verified file bytes. Optional members may remain absent only when the manifest selects `optionalMods: "skip"`. The GTS AE configuration installs every optional member; the base configuration skips them and rejects paid Creation files before launch. File presence does not prove a compatible game version: follow the pinned collection's prerequisites before starting. Constellations requires Anniversary content and a prepared downgraded game; Femme Fatale PLUS requires Phantom Liberty. Do not skip a required download to make a run pass.

For another finish condition, `ready` can read an actual DOM selector or Vortex state path. Choose something that establishes game readiness, not a control that is always present.

Use the [four pinned collections](proposal.md#real-collection-matrix). Do not invent URLs or substitute a generated collection. Undecided collection choices are excluded; hardware conditions and release budgets still need agreement.

The helpers compose the proposal's starting and finishing conditions:

```typescript title="collection-cases.ts"
import { defineBenchmark } from "./harness/benchmarks/index";

export const c2Cases = [
  defineBenchmark({
    id: "B1-C2-AE",
    name: "Cold collection install",
    dataset: "real",
    async run(vortex) {
      await vortex.prepareCollection({ cache: "cold" });
      await vortex.collectionMeasure(async () => {
        await vortex.addCollection();
        await vortex.deploy();
      });
    },
  }),
  defineBenchmark({
    id: "B2-C2-AE",
    name: "Warm collection install",
    dataset: "real",
    async run(vortex) {
      await vortex.prepareCollection({ cache: "warm" });
      await vortex.collectionMeasure(async () => {
        await vortex.addCollection();
        await vortex.deploy();
      });
    },
  }),
  defineBenchmark({
    id: "B3-C2-AE",
    name: "Full deploy",
    dataset: "real",
    async run(vortex) {
      await vortex.addCollection();
      await vortex.deploy();
      await vortex.purge();
      await vortex.measure("deploy.full", () => vortex.deploy());
      await vortex.verifyReady();
    },
  }),
  defineBenchmark({
    id: "B4-C2-AE",
    name: "Deploy with nothing changed",
    dataset: "real",
    async run(vortex) {
      await vortex.addCollection();
      await vortex.deploy();
      await vortex.measure("deploy.unchanged", () => vortex.deploy());
      await vortex.verifyReady();
    },
  }),
  defineBenchmark({
    id: "B5-C2-AE",
    name: "Startup with a large collection",
    dataset: "real",
    async run(vortex) {
      await vortex.addCollection();
      await vortex.deploy();
      await vortex.restartToMods();
    },
  }),
];
```

Supply the prepared C2-AE manifest to the runner. The supplied matrix includes B5 for every named collection. A custom workload can omit startup, but that changes the coverage and must be reported.

Save this runner beside those two files, then run `pnpm exec tsx run-collection.mts`:

```typescript title="run-collection.mts"
import { runBenchmarks } from "./harness/benchmarks/index";
import { collectionManifest } from "./collection-config";
import { c2Cases } from "./collection-cases";

const results = await runBenchmarks({
  benchmarks: c2Cases,
  manifest: collectionManifest,
  select: ["B1-C2-AE"],
  repeats: 1, // First installation check; use three repeats for an agreed baseline.
  outputDir: "harness/.artifacts/my-real-collection-run",
});
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
```

`runBenchmarks()` resolves after successful cases and teardown. If a case fails or is blocked, it writes `results.json` and then throws; catch that error and inspect the retained report for the reason. Callback evidence is provisional until the final report passes. Remove `select` to run all five cases. Each case and repeat creates a fresh workspace; warm preparation downloads genuine members outside the clock. Allow enough time and disk space for the collection. After a failed attempt, keep its report and fixture: a resumed installation is useful setup validation, but is not a new cold baseline sample.

Warm preparation downloads the collection outside the measurement, removes its installed mods, and keeps completed archives for the timed install. Cached does not mean synthetic: these are the genuine archives belonging to the pinned revision. The warm download phase can be absent because no member download was needed. Cold preparation requires empty download records and files.

`collectionMeasure()` records the overall active duration and available phase events, excludes observed prompt waits and pauses, and checks `ready` after your callback. Phase durations overlap. Collection-driver coordination remains in total elapsed time: the current installer helper includes a four-second driver wait and completion polling every five seconds. These are recorded as control overhead, not subtracted as user waits.

B5 launches a new process and checks a working Mods search; it does not time navigation in an already-running app. A measurement includes the whole callback and the resulting paint. Put readiness work inside it when that is part of your intended finish condition. Deployment byte verification runs afterward and can still fail the case. Collection listener cleanup and post-run integrity checks do not extend the ready boundary.

For an additional known wait, use `vortex.excluded("user-wait", async () => { ... })` or `"pause"`, with a reason grounded in the test. Keep excluded intervals in the report.

## T3: seed and operate Downloads

`seedDownloads(count)` generates local ZIP archives and registers their finished Downloads records. These archives were never downloaded from Nexus. It verifies the requested record count. The names are `benchmark-download-00000.zip`, `benchmark-download-00001.zip`, and so on. This fixture exercises the Downloads UI, not Nexus throughput.

Create separate cases for scroll, sort, and filter so each action starts with a fresh unfiltered list:

```typescript title="downloads-recipe.ts"
import assert from "node:assert/strict";
import { defineBenchmark } from "./harness/benchmarks/index";

export function downloadsCase(count: number, action: "scroll" | "sort" | "filter") {
  return defineBenchmark({
    id: `T3-${action}-${count}`,
    name: `${action} ${count} synthetic Downloads rows`,
    dataset: "synthetic",
    async run(vortex) {
      await vortex.seedDownloads(count);
      const downloads = vortex.table("downloads");
      await downloads.open();
      assert.equal((await downloads.rows()).length, count);

      if (action === "scroll") {
        await downloads.scroll();
      } else if (action === "sort") {
        await downloads.sort("filename");
      } else {
        await downloads.filter({
          control: "#table-downloads .table-header-pane .header-filename input",
          value: "benchmark-download-00001",
          expect: { selector: "#table-downloads tr[data-rowid]", read: "count", equals: 1 },
        });
        const matching = await downloads.rows();
        assert.equal(matching.length, 1);
        assert.match(matching[0]!, /benchmark-download-00001/);
      }
    },
  });
}
```

Use counts 150, 570, 1,594, and 2,685. The scroll helper observes viewport movement and rendered rows; sort checks changed row order; the filter case additionally verifies the specific remaining filename.

For the catalog's Downloads workload, `prepare(vortex, count)` calls `seedDownloads(count)`. Its sort action calls `table("downloads").sort("filename")`; its filter action uses the filename input and changed row-count expectation above, then asserts the remaining filename. The released Downloads column is `filename`, rather than the Mods column named `name`. These are actual action functions, rather than empty callbacks.

All these archives are initially finished. To benchmark another status filter, provide a fixture containing the statuses being tested and verify that filtering changes the result. Do not reinterpret local archive seeding as network download performance.

## T2: install real data before testing game tables

A Plugins or Load Order case first installs and deploys a pinned real collection for the chosen game, then verifies that the intended page contains the requested number of rows. Mod count and plugin/load-order row count are different quantities. A 1,594-mod collection does not automatically provide 1,594 valid plugins.

Choose fixtures that support each requested count and valid engine data. If the engine cannot support a requested count, or the collection lacks matching rows, record that case as blocked. Do not create synthetic plugin names to fill the gap.

The provided `realGameTable()` helper installs and deploys the collection, checks readiness and row count, and performs the configured UI actions. This function adds one fixture to the catalog:

```typescript title="game-table-recipe.ts"
import assert from "node:assert/strict";
import { configuration } from "./benchmarks/config";
import { realGameTable } from "./benchmarks/workloads";
import type { RealTableBindings } from "./benchmarks/types";

export function configurePlugins(
  count: 150 | 570 | 1594 | 2685,
  bindings: RealTableBindings,
  nameColumn?: "name" | "filename",
) {
  assert.equal(bindings.table, "plugins");
  const workload = realGameTable(bindings);
  if (nameColumn) {
    workload.actions.sort = (vortex) => vortex.table("plugins").sort(nameColumn);
  }
  configuration.gameTables.plugins ??= {};
  configuration.gameTables.plugins[count] = workload;
}
```

Configure each table and count separately, for example `configuration.gameTables.plugins = { 150: realGameTable(bindings150), 570: realGameTable(bindings570) }`. Use the same shape for `configuration.gameTables["load-order"]`. Each entry supplies the real fixture and control mapping for that count. Omitted counts are blocked. The catalog's scroll action uses the same preparation and calls `table(tableName).scroll()`.

### Fill the game-specific bindings

Inspect the actual installed game page before setting these values:

- `definition.page` is the visible navigation label, such as the game's actual Plugins or Load Order label.
- `root` selects the table; `rows` selects its data rows; `scroller` selects its scrollable pane.
- An action's `control` is the actual source row handle, checkbox, sort header, or button.
- Drag also requires `target`, the actual destination row or drop target.
- `expect` identifies a changed outcome and its final value. It does not identify the button being clicked.

Do not copy a Bethesda state path into a different engine. For Bethesda's Gamebryo plugin manager, these shapes are supported by Vortex's state:

```typescript
const disabled = {
  path: ["loadOrder", actualPluginFilename.toLowerCase(), "enabled"],
  equals: false,
};
const reordered = {
  path: ["loadOrder", actualPluginFilename.toLowerCase(), "loadOrder"],
  equals: expectedIndexAfterDrag,
};
```

`actualPluginFilename` must come from the installed plugin data, and `expectedIndexAfterDrag` must reflect the intended drop. File-based load-order extensions can use different state. Read the actual before/after state through `vortex.call("vortex_query", { path: [...] })` or use a DOM order observation.

A complete drag call is:

```typescript
await vortex.table("plugins").drag({
  control: sourceHandleSelector,
  target: destinationRowSelector,
  name: "plugins.reorder",
  expect: {
    path: ["loadOrder", actualPluginFilename.toLowerCase(), "loadOrder"],
    equals: expectedIndexAfterDrag,
  },
});
```

Supply `sourceHandleSelector` and `destinationRowSelector` from the observed page. Some Plugins pages manage ordering through rules rather than draggable rows. If dragging is unsupported, record the missing action as blocked; do not replace it with a state dispatch.

For a fully rendered table, a sort can use `expect: { selector: rowSelector, read: "texts", equals: expectedRowTexts }` with the full expected order. Virtualized tables leave off-screen cells blank, so their row text alone cannot prove the complete order. If the observed page uses the same `name` or `filename` column structure as the common tables, call `configurePlugins(count, bindings, "name")` or `"filename"` to use the shared sort helper. It collects actual names before timing and checks every row ID afterward. A missing matching column blocks the case.

For other game columns, provide a custom function in the workload's `actions.sort` and compare the complete row-ID order against your real fixture's expected order. Use `vortex.page` and `vortex.measure()` as in the standalone case example. Avoid treating a changed sort preference or only the first matching row as proof that the whole list sorted.

For enabled state, use the correct engine state path or a visible checkbox attribute. Choose a disabled target for enable and an enabled target for disable, otherwise the helper rejects a no-op.

The SDK's `Observation` accepts `selector` for DOM reads or `path: string[]` for a state read. DOM `read` can be `"text"`, `"texts"`, `"count"`, `"value"`, or `"attribute"`; attribute reads also need `attribute`. Every `Expectation` adds `equals`. Arrays and objects must match the actual returned shape.

## T4: operate another page while the large Mods list remains

A concrete local workload is to filter the Downloads page while the larger Mods library remains installed. Seed a modest Downloads list outside the timed action, perform its real filter, and verify both the matching archive and the retained Mods count.

```typescript title="background-recipe.ts"
import assert from "node:assert/strict";
import type { BackgroundWorkload } from "./benchmarks/types";

export const downloadsInBackground: BackgroundWorkload = {
  id: "downloads-filename-filter",
  name: "Filter Downloads while a large Mods library remains installed",
  async run(vortex, count) {
    // The T4 catalog case already calls seedMods(count).
    await vortex.seedDownloads(150);
    const downloads = vortex.table("downloads");
    await downloads.filter({
      control: "#table-downloads .table-header-pane .header-filename input",
      value: "benchmark-download-00001",
      expect: { selector: "#table-downloads tr[data-rowid]", read: "count", equals: 1 },
    });
    const matching = await downloads.rows();
    assert.equal(matching.length, 1);
    assert.match(matching[0]!, /benchmark-download-00001/);

    const mods = await vortex.call<Record<string, unknown>>("vortex_query", {
      path: ["persistent", "mods", vortex.gameId],
    });
    assert.equal(Object.keys(mods).length, count);
  },
};
```

Put this workload in `configuration.background.workloads`. Each T4 case has a fresh session and its requested 150, 570, 1,594, or 2,685 Mods rows. The Downloads filter helper already times the action and observes its changed rows. Opening the other page is setup, not the measured outcome.

This example gives T4 one concrete other-page action. Add other agreed pages as additional workloads only after identifying their real controls and changed outcomes. Label this workload synthetic: it does not install a Nexus collection or simulate an actual background download.

## Optional experiments

A timed `purge()` case and `memoryWhile()` sampling can be added separately. Memory sampling covers renderer JavaScript heap, not total app memory. Collection updates or profile/game switching need explicit setup and resulting-state checks; keep these separate from the agreed B1–B5 and T1–T4 coverage.
