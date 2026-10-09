# Collection setup

Use [guided setup](../getting-started/setup.md) for login and machine paths. Your code can then load a collection without repeating those details.

## preparedCollection

Import from `./benchmarks/setup`.

<!-- contract:proposal.setup:preparedCollection -->

```typescript
export function preparedCollection(code: CollectionCode, file = benchmarkSetupFile): RealCollection;
```

<!-- /contract -->

Returns saved configuration for C1, C2, C2-AE, C3 or C5. The catalog supplies game, revision, members and readiness files. Setup supplies snapshot, private login-cache location, QA acknowledgement and warning policy. Missing or inconsistent configuration throws. A real run rechecks files and account access; loading configuration does not prove readiness.

## prepareCollection

Import from `./benchmarks/setup`. This prepares files, not a collection installation.

<!-- contract:proposal.setup:prepareCollection -->

```typescript
export async function prepareCollection(options: PrepareCollectionOptions): Promise<RealCollection>;
```

<!-- /contract -->

<!-- contract:proposal.setup:PrepareCollectionOptions -->

```typescript
export interface PrepareCollectionOptions {
  code: CollectionCode;
  /** Required acknowledgement; setup never infers that a user's account is disposable. */
  dedicatedWindowsAccount: true;
  /** The operator confirms the source is clean and the game/launcher are closed. */
  cleanSource: true;
  authCache: string;
  owner: string;
  /** Copy this source into a new snapshot, even when an older snapshot is saved. */
  source?: string;
  /** Register an existing verified copy rather than copying the installed game. */
  snapshot?: string;
  warningsAsErrors?: boolean;
  setupFile?: string;
  snapshotRoot?: string;
}
```

<!-- /contract -->

Finds the Steam game when `source` is omitted, creates or reuses a verified snapshot, saves local choices and returns configuration. Use `snapshot` to register a verified copy. `cleanSource` and `dedicatedWindowsAccount` are operator acknowledgements. The CLI manages the private `authCache` and exclusive `owner` for you.

An explicit `source` always creates a new snapshot. Omit both `source` and `snapshot` to reuse a saved copy for that game/content, or discover and copy the installed game if none is saved. Choose either `source` or `snapshot`; passing both fails.

Creation rejects linked files, deployment manifests and existing destinations. Reuse checks every byte. A partial or altered copy fails; it is never silently repaired.

## createGameSnapshot and verifyGameSnapshot

Import from `./harness/benchmarks/index` for custom fixtures.

<!-- contract:benchmarks.gameFixtures:createGameSnapshot -->

```typescript
export async function createGameSnapshot(options: GameSnapshotOptions): Promise<GameSnapshot>;
```

<!-- /contract -->

<!-- contract:benchmarks.gameFixtures:GameSnapshotOptions -->

```typescript
export interface GameSnapshotOptions {
  /** A known clean installed game. Hashes prove integrity, not Steam provenance. */
  source: string;
  /** New directory, outside source. Neither existing snapshots nor sources are overwritten. */
  destination: string;
  /** Exact relative files to leave out, for example incomplete paid Creation downloads. */
  exclude?: readonly string[];
}
```

<!-- /contract -->

<!-- contract:benchmarks.gameFixtures:verifyGameSnapshot -->

```typescript
export async function verifyGameSnapshot(
  snapshot: string,
  manifestFile = gameSnapshotManifest(snapshot),
): Promise<GameSnapshot>;
```

<!-- /contract -->

`createGameSnapshot()` copies a known clean game into a new directory, hashes/checks every file, and returns the manifest stored beside the copy. It never overwrites source or existing snapshots. `verifyGameSnapshot()` returns the manifest after checking exact inventory and bytes. Changed, extra or missing files fail.

Matching hashes prove copy integrity, not a clean source or Steam provenance. Never cache a game with deployed mods.

## createSkyrimSnapshot

<!-- contract:benchmarks.skyrimEdition:createSkyrimSnapshot -->

```typescript
export async function createSkyrimSnapshot(options: SkyrimSnapshotOptions): Promise<GameSnapshot>;
```

<!-- /contract -->

<!-- contract:benchmarks.skyrimEdition:SkyrimSnapshotOptions -->

```typescript
export interface SkyrimSnapshotOptions {
  source: string;
  destination: string;
  edition: "base" | "anniversary";
}
```

<!-- /contract -->

`edition: "base"` keeps four free Creations and omits paid files. `"anniversary"` requires all 74 Creation plugins and nonempty main archives. Finish purchased-content downloads and close Skyrim first. Constellations also needs a separately prepared downgrade; this helper does not downgrade games.

## Installing and checking

In a real session, `addCollection()` installs once, `deploy()` deploys and `verifyReady()` checks configured files. B1–B5 supply the complete workflow, including native UI completion. [Collection benchmarks](../testing/benchmarks.md) explains cold/warm preparation, optionals, warnings and failure evidence.

Pause/resume belongs in explicit pause tests or operator controls. It cannot recover failed members. Ordinary automation performs no recovery.
