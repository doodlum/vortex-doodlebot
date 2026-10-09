# Prepare table fixtures

Use this guide when changing the supplied table workloads in `benchmarks/config.ts`. For a new standalone measurement, start with [write a benchmark](adding-benchmarks.md). The [proposal](proposal.md#table-responsiveness) defines the row counts and required actions.

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
