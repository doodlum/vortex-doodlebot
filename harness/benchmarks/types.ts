export const sizes = [150, 570, 1594, 2685] as const;
export type DatasetKind = "real" | "synthetic";
export type TableName = "mods" | "downloads" | "plugins" | "load-order";
export interface Observation {
  /** Every path is relative to the copied game; observes actual regular files. */
  gameFiles?: readonly string[];
  /** Read a DOM value or a read-only Vortex state path. */
  selector?: string;
  path?: string[];
  read?: "text" | "count" | "texts" | "value" | "attribute";
  attribute?: string;
}
export interface Expectation extends Observation {
  equals: unknown;
}
export interface ActionOptions {
  /** CSS selector for the actual user control. Exactly one visible match is required. */
  control: string;
  /** An observable consequence, different from its value before the action. */
  expect: Expectation;
  name?: string;
}
export interface InputOptions extends ActionOptions {
  value: string;
}
export interface DragOptions extends ActionOptions {
  target: string;
}
export interface TableDefinition {
  page: string;
  root: string;
  rows: string;
  /** Actual scrollable element, not a placeholder or merely a table wrapper. */
  scroller: string;
  /** Required for restart usability probe. */
  search?: string;
}
export interface RunManifest {
  /** The installer executable; no source target is accepted. Omit to locate released Vortex. */
  executable?: string;
  profile: {
    hardware: string;
    storage: string;
    bandwidth: string;
    account: "anonymous" | "premium";
    osSecurity: string;
    vortexBuild: string;
  };
  synthetic?: { count: number; filesPerMod?: number };
  collection?: {
    url: string;
    engine: string;
    gameId: string;
    expectedMods: number;
    /** Explicit optional-member selection. Defaults to skip for other collections. */
    optionalMods?: "skip" | "install";
    /** Direct SDK manifests default to strict warnings. Catalog factories allow warnings unless overridden. */
    warningsAsErrors?: boolean;
    /** GTS requires a verified base or paid Anniversary content fixture. */
    skyrimEdition?: "base" | "anniversary";
    /** Private mutable OAuth cache: receives rotations after app exit. Never included in results. */
    authCache: string;
    /** Read-only fixture to copy. Never point at the managed game for mutation. */
    gameFixture: string;
    /** Explicit opt-in to copying and modifying a private game fixture. */
    allowGameFixtureCopy: true;
    /** Explicit declaration: this is a QA-only Windows account/test machine.
     * Stock releases may ignore Documents preloads; game support can write that
     * account's Documents/LocalAppData. cleanStart backs up and resets only
     * supported, allowlisted settings files; saves and purchased content stay.
     */
    dedicatedWindowsAccount?: true;
    /** Game-specific readiness observable after deployment. Game launch is out of scope. */
    ready: Expectation;
  };
  /** Engine-specific tables require an explicit mapping and real installed data. */
  tables?: Partial<Record<TableName, TableDefinition>>;
  /** Timing limits are agreed by humans; none are supplied by this SDK. */
  budgets?: Record<string, { maxMs?: number; baselineMs?: number; maxSlowdownPercent?: number }>;
  timeoutMs?: number;
}
export interface Measurement {
  name: string;
  wallMs: number;
  excludedMs: number;
  activeMs: number;
  inputDelayMs?: number | null;
  blockedMs?: number;
  worstTaskMs?: number;
  worstFrameMs?: number;
}
export interface PhaseEvent {
  phase: "add" | "download" | "install" | "deploy";
  edge: "start" | "end";
  at: number;
  source: string;
}
export interface Exclusion {
  reason: "user-wait" | "pause";
  start: number;
  end: number;
}
export interface Benchmark {
  id: string;
  name: string;
  dataset: DatasetKind;
  run: (vortex: import("./session").BenchmarkSession) => Promise<void>;
}
export interface RepeatResult {
  warnings: import("../src/collections").CollectionWarning[];
  repeat: number;
  status: "passed" | "blocked" | "failed";
  reason?: string;
  measurements: Measurement[];
  phases: PhaseEvent[];
  exclusions: Exclusion[];
  evidence: unknown[];
}
export interface BenchmarkResult {
  id: string;
  name: string;
  dataset: DatasetKind;
  status: "passed" | "blocked" | "failed";
  repeats: RepeatResult[];
  summary: Record<
    string,
    { samples: number; medianMs: number; minMs: number; maxMs: number; spreadMs: number }
  >;
  regressions: string[];
}
export class BenchmarkBlocked extends Error {}
