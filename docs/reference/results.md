# Options and results

Import these types from `./harness/benchmarks/index`. The [results guide](../testing/results.md) explains complete reports and comparisons.

## RunManifest

<!-- contract:benchmarks.types:RunManifest -->

```typescript
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
```

<!-- /contract -->

`profile` records hardware, storage, bandwidth, account, OS/security and Vortex build. Formal runs block undecided fields. `exploratoryManifest()` records available facts and labels unmeasured conditions; it does not approve a baseline.

`synthetic` sets generated counts. `collection` supplies a pinned real collection. `tables` maps game-specific controls. `budgets` contains human-agreed limits; none are invented.

`timeoutMs` defaults to two minutes for synthetic sessions or one hour for real sessions. Set a longer explicit timeout for large collections. `executable` overrides the detected release. A custom build needs its own evidence and is not a stock-release baseline.

## Measurement

<!-- contract:benchmarks.types:Measurement -->

```typescript
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
```

<!-- /contract -->

| Field                                      | Meaning                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `wallMs`                                   | Elapsed time including exclusions.                   |
| `excludedMs`                               | Recorded excluded waits.                             |
| `activeMs`                                 | `wallMs - excludedMs`, not CPU time.                 |
| `inputDelayMs`                             | Input metric when available; `null` is not zero.     |
| `blockedMs`, `worstTaskMs`, `worstFrameMs` | Renderer responsiveness observations, when captured. |

Lost collection phase events block timing even if functional verification finishes.

## BenchmarkResult and RepeatResult

<!-- contract:benchmarks.types:BenchmarkResult -->

```typescript
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
```

<!-- /contract -->

<!-- contract:benchmarks.types:RepeatResult -->

```typescript
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
```

<!-- /contract -->

| Status    | Meaning                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `passed`  | Actions, assertions and teardown completed; supplied budgets also passed.     |
| `failed`  | An action, assertion, completion or cleanup failed; evidence is retained.     |
| `blocked` | Required data, controls, access or timing was unavailable; no passing sample. |

`summary` contains successful-sample medians, minima, maxima and spread. One sample is a smoke result. An empty summary is not a zero-duration pass. Warnings remain recorded under either policy; unresolved collection members always fail.

The SDK writes the manifest and results to `results.json`. The catalog also writes `suite.json` and per-group `run-info.json`. Choose a new output directory per attempt.
