import assert from "node:assert/strict";
import type {
  BackgroundWorkload,
  DownloadsAction,
  GameTableAction,
  RealTableBindings,
  Session,
  TableWorkload,
} from "./types";

export async function filterOneDownload(vortex: Session): Promise<void> {
  const downloads = vortex.table("downloads");
  await downloads.filter({
    control: "#table-downloads .table-header-pane .header-filename input",
    value: "benchmark-download-00001",
    expect: { selector: "#table-downloads tr[data-rowid]", read: "count", equals: 1 },
  });
  const matching = await downloads.rows();
  assert.equal(matching.length, 1);
  assert.match(matching[0]!, /benchmark-download-00001/);
}

export const downloadsWorkload: TableWorkload<DownloadsAction> = {
  dataset: "synthetic",
  missing: "Released Downloads table and its filename controls must be available",
  async prepare(vortex, count) {
    await vortex.seedDownloads(count);
    const downloads = vortex.table("downloads");
    await downloads.open();
    assert.equal((await downloads.rows()).length, count);
  },
  actions: {
    scroll: async (vortex) => vortex.table("downloads").scroll(),
    sort: async (vortex) => vortex.table("downloads").sort("filename"),
    filter: filterOneDownload,
  },
};

export const downloadsInBackground: BackgroundWorkload = {
  id: "downloads-filename-filter",
  name: "Filter Downloads while the Mods library remains installed",
  async run(vortex, count) {
    await vortex.seedDownloads(150);
    await filterOneDownload(vortex);
    const mods = await vortex.call<Record<string, unknown>>("vortex_query", {
      path: ["persistent", "mods", vortex.gameId],
    });
    assert.equal(Object.keys(mods).length, count);
  },
};

/** Fill bindings from the observed installed game, never from invented plugin names. */
export function realGameTable(bindings: RealTableBindings): TableWorkload<GameTableAction> {
  const actions: TableWorkload<GameTableAction>["actions"] = {
    scroll: async (vortex) => vortex.table(bindings.table).scroll(),
  };
  if (bindings.drag) {
    const options = bindings.drag;
    actions.drag = async (vortex) => vortex.table(bindings.table).drag(options);
  }
  if (bindings.sort) {
    const options = bindings.sort;
    actions.sort = async (vortex) => vortex.table(bindings.table).sort(options);
  }
  if (bindings.enable) {
    const options = bindings.enable;
    actions.enable = async (vortex) => vortex.table(bindings.table).enable(options);
  }
  if (bindings.disable) {
    const options = bindings.disable;
    actions.disable = async (vortex) => vortex.table(bindings.table).disable(options);
  }
  return {
    dataset: "real",
    manifest: {
      ...bindings.manifest,
      tables: { ...bindings.manifest.tables, [bindings.table]: bindings.definition },
    },
    missing: "Supply a pinned real collection, verified row count and observed game-table controls",
    async prepare(vortex, count) {
      await vortex.addCollection();
      await vortex.deploy();
      await vortex.verifyReady();
      await vortex.table(bindings.table).open();
      const actualCount = await vortex.page.locator(bindings.definition.rows).count();
      if (actualCount !== count) {
        vortex.block(`Requested ${count} ${bindings.table} rows; real fixture has ${actualCount}`);
      }
    },
    actions,
  };
}
