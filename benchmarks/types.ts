import type {
  ActionOptions,
  Benchmark,
  DatasetKind,
  DragOptions,
  RunManifest,
  TableDefinition,
} from "../harness/benchmarks/index";

export type Session = Parameters<Benchmark["run"]>[0];
export type RealCollection = NonNullable<RunManifest["collection"]> & {
  dedicatedWindowsAccount: true;
};
export type RealRunManifest = Omit<RunManifest, "collection"> & { collection: RealCollection };
export type CollectionCode = "C1" | "C2" | "C2-AE" | "C3" | "C5";
export type GameTable = "plugins" | "load-order";
export type GameTableAction = "scroll" | "drag" | "sort" | "enable" | "disable";
export type DownloadsAction = "scroll" | "sort" | "filter";
export type ModsAction =
  | "scroll"
  | "sort"
  | "group"
  | "ungroup"
  | "search"
  | "filter"
  | "enable"
  | "disable"
  | "select-all";

export interface TableWorkload<Action extends string> {
  dataset: DatasetKind;
  manifest?: RunManifest;
  missing: string;
  prepare: (vortex: Session, count: number) => Promise<void>;
  actions: Partial<Record<Action, (vortex: Session) => Promise<unknown>>>;
}

export interface RealTableBindings {
  table: GameTable;
  manifest: RealRunManifest;
  definition: TableDefinition;
  // Omit unsupported actions: their named cases become blocked.
  drag?: DragOptions;
  sort?: ActionOptions;
  enable?: ActionOptions;
  disable?: ActionOptions;
}

export interface BackgroundWorkload {
  id: string;
  name: string;
  run: (vortex: Session, count: number) => Promise<void>;
}

export interface Configuration {
  localManifest: RunManifest;
  realProfile: RunManifest["profile"];
  collections: Partial<Record<CollectionCode, RealCollection>>;
  gameTables: Partial<Record<GameTable, Partial<Record<number, TableWorkload<GameTableAction>>>>>;
  downloads: TableWorkload<DownloadsAction>;
  background: { workloads: BackgroundWorkload[] };
}

export interface BenchmarkGroup {
  id: string;
  manifest: RunManifest;
  cases: Benchmark[];
  // A missing configuration can be reported without launching the app.
  missing?: string;
}
