import { defineBenchmark, sizes } from "../harness/benchmarks/index";
import type { Benchmark } from "../harness/benchmarks/index";
import { configuration } from "./config";
import type {
  BenchmarkGroup,
  CollectionCode,
  Configuration,
  GameTable,
  GameTableAction,
  ModsAction,
  Session,
} from "./types";

export const collections: ReadonlyArray<{
  code: CollectionCode;
  name: string;
  engine: string;
  size: string;
  startup: boolean;
}> = [
  { code: "C1", name: "Immersive and Adult", engine: "Creation", size: "Large", startup: true },
  {
    code: "C2",
    name: "Gate to Sovngarde — base game, skip optionals",
    engine: "Creation",
    size: "Large; 1,975 proposed",
    startup: true,
  },
  {
    code: "C2-AE",
    name: "Gate to Sovngarde — paid Anniversary content, install optionals",
    engine: "Creation",
    size: "Large; same revision as C2",
    startup: true,
  },
  {
    code: "C3",
    name: "Constellations",
    engine: "Creation",
    size: "Large; 2,444 proposed",
    startup: true,
  },
  {
    code: "C5",
    name: "Night City: Femme Fatale PLUS",
    engine: "REDengine 4",
    size: "Large; 1,000+ proposed",
    startup: true,
  },
];

export const modsActions: readonly ModsAction[] = [
  "scroll",
  "sort",
  "group",
  "ungroup",
  "search",
  "filter",
  "enable",
  "disable",
  "select-all",
];
export const gameTableActions: readonly GameTableAction[] = [
  "scroll",
  "drag",
  "sort",
  "enable",
  "disable",
];
export const gameTables: readonly GameTable[] = ["plugins", "load-order"];
export const downloadsActions = ["scroll", "sort", "filter"] as const;

const collectionNames = {
  B1: "Cold collection install",
  B2: "Warm collection install",
  B3: "Full deploy",
  B4: "Deploy with nothing changed",
  B5: "Startup with a large collection",
};
type CollectionBenchmark = keyof typeof collectionNames;

async function collectionRun(vortex: Session, kind: CollectionBenchmark): Promise<void> {
  if (kind === "B1" || kind === "B2") {
    await vortex.prepareCollection({ cache: kind === "B1" ? "cold" : "warm" });
    await vortex.collectionMeasure(async () => {
      await vortex.addCollection();
      await vortex.deploy();
    });
    return;
  }
  await vortex.addCollection();
  await vortex.deploy();
  if (kind === "B3") {
    await vortex.purge();
    await vortex.measure("deploy.full", () => vortex.deploy());
    await vortex.verifyReady();
  } else if (kind === "B4") {
    await vortex.measure("deploy.unchanged", () => vortex.deploy());
    await vortex.verifyReady();
  } else {
    await vortex.verifyReady();
    await vortex.restartToMods();
    await vortex.verifyReady();
  }
}

function modsCase(count: number, action: ModsAction): Benchmark {
  return defineBenchmark({
    id: `T1-${action}-${count}`,
    name: `${action} ${count} synthetic Mods rows`,
    dataset: "synthetic",
    async run(vortex: Session) {
      const ids = await vortex.seedMods(count);
      const mods = vortex.table("mods");
      await mods.open();
      vortex.assert(ids.length === count, `Expected ${count} seeded Mods IDs`);
      switch (action) {
        case "scroll":
          await mods.scroll();
          break;
        case "sort":
          await mods.sort("name");
          break;
        case "group":
          await mods.group("status");
          break;
        case "ungroup":
          await mods.group("status");
          await mods.ungroup();
          break;
        case "search":
          await mods.search({
            control: "#table-mods .header-name input",
            value: "no-matching-mod",
            expect: { selector: "#table-mods tr[data-rowid]", read: "count", equals: 0 },
          });
          break;
        case "filter":
          await mods.disable([ids[0]!]);
          await mods.filter("enabled");
          break;
        case "enable":
          await mods.disable([ids[0]!]);
          await mods.enable([ids[0]!]);
          break;
        case "disable":
          await mods.disable([ids[0]!]);
          break;
        case "select-all":
          await mods.selectAll();
          break;
      }
    },
  });
}

export function buildCatalog(config: Configuration = configuration): BenchmarkGroup[] {
  const groups: BenchmarkGroup[] = [];
  for (const candidate of collections) {
    const collection = config.collections[candidate.code];
    const kinds: CollectionBenchmark[] = ["B1", "B2", "B3", "B4"];
    if (candidate.startup) kinds.push("B5");
    groups.push({
      id: candidate.code,
      manifest: { ...config.localManifest, profile: config.realProfile, collection },
      missing: collection
        ? undefined
        : `${candidate.code} ${candidate.name}: pinned revision, confirmed game/mod count, private OAuth cache, copied game fixture, QA-only Windows account and readiness check are TBD`,
      cases: kinds.map((kind) =>
        defineBenchmark({
          id: `${kind}-${candidate.code}`,
          name: `${collectionNames[kind]}: ${candidate.name}`,
          dataset: "real",
          run: async (vortex) => collectionRun(vortex, kind),
        }),
      ),
    });
  }
  for (const count of sizes) {
    const local = {
      ...config.localManifest,
      synthetic: { ...config.localManifest.synthetic, count },
    };
    groups.push({
      id: `T1-${count}`,
      manifest: local,
      cases: modsActions.map((action) => modsCase(count, action)),
    });
    for (const table of gameTables) {
      const workload = config.gameTables[table]?.[count];
      groups.push({
        id: `T2-${table}-${count}`,
        manifest: workload?.manifest ?? { ...local, profile: config.realProfile },
        missing: workload
          ? undefined
          : `T2 ${table}: supply real installed engine data, actual table selectors, exact ${count}-row fixture and action bindings through realGameTable()`,
        cases: gameTableActions.map((action) =>
          defineBenchmark({
            id: `T2-${table}-${action}-${count}`,
            name: `${action} ${count} real ${table} rows`,
            dataset: "real",
            async run(vortex: Session) {
              if (!workload) return vortex.block(`No ${table} workload configured`);
              const perform = workload.actions[action];
              if (!perform)
                return vortex.block(
                  `${table}.${action}: ${workload.missing}; action unsupported or not configured`,
                );
              await workload.prepare(vortex, count);
              await perform(vortex);
            },
          }),
        ),
      });
    }
    const downloads = config.downloads;
    groups.push({
      id: `T3-${count}`,
      manifest: downloads.manifest ?? local,
      cases: downloadsActions.map((action) =>
        defineBenchmark({
          id: `T3-${action}-${count}`,
          name: `${action} ${count} synthetic Downloads rows`,
          dataset: downloads.dataset,
          async run(vortex: Session) {
            const perform = downloads.actions[action];
            if (!perform) return vortex.block(`Downloads.${action}: ${downloads.missing}`);
            await downloads.prepare(vortex, count);
            await perform(vortex);
          },
        }),
      ),
    });
    groups.push({
      id: `T4-${count}`,
      manifest: local,
      missing:
        config.background.workloads.length === 0
          ? "Configure an other-page action for T4"
          : undefined,
      cases: (config.background.workloads.length
        ? config.background.workloads
        : [
            {
              id: "background",
              name: "Other page responsiveness",
              run: async (vortex: Session) => vortex.block("Configure an other-page action for T4"),
            },
          ]
      ).map((workload, index) =>
        defineBenchmark({
          id: index === 0 ? `T4-background-${count}` : `T4-${workload.id}-${count}`,
          name: `${workload.name}: ${count} synthetic Mods rows`,
          dataset: "synthetic",
          async run(vortex: Session) {
            await vortex.seedMods(count);
            await workload.run(vortex, count);
          },
        }),
      ),
    });
  }
  return groups;
}

export const catalog = buildCatalog();
export const allCases = catalog.flatMap((group) => group.cases);
