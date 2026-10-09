# Prepare your machine

Run the guided setup from the folder you cloned:

```powershell
pnpm run setup
```

Choose **Local test** to create `my-first-test.mts` and get its run command. It needs released Vortex, but no Nexus login or commercial game. Existing example files are left untouched.

Choose **Prepare a real collection** when you want to install Nexus mods. Setup walks through the collection, game, login, snapshot and warning policy. It does not start collection downloads.

## Real collection setup

Before starting, finish Steam's game installation and updates, close the game, and use a clean source with no deployed mods. For paid Skyrim content, let Skyrim finish its own Anniversary downloads first.

The unattended collection runner requires Nexus Premium. Use a QA-only Windows account or test machine: Vortex's game support can write that account's Documents and AppData. Setup asks you to confirm this once for each saved collection choice.

Setup then:

1. Shows the pinned collection choices, including separate base and Anniversary GTS cases.
2. Finds Skyrim or Cyberpunk through Steam's registered location and library manifests. You can supply another directory if it is not found.
3. Offers a previously saved snapshot, an existing verified snapshot, or a new copy of the installed game.
4. Opens an isolated Vortex for login. Complete the browser login yourself when needed. Credentials stay in the private local cache.
5. Checks and saves the snapshot, then prints the exact benchmark command.

A **snapshot** is a reusable clean game copy. A **working copy** is the separate copy each benchmark modifies. Your Steam installation stays untouched. Allow space for both copies, collection archives, staging and deployment; the collection size can be much larger than the game itself.

GTS base snapshots omit paid Creation files. Anniversary snapshots require the complete paid inventory. Constellations needs a separately downgraded snapshot; setup can register it but does not perform the downgrade. Collection-specific access, instructions and readiness checks still apply when the actual run starts.

## See what is saved

```powershell
pnpm run setup -- --status
```

This shows detected games, cached login presence, tracked snapshots, verification dates and saved collection choices. It does not launch Vortex or contact Nexus. **Cached** means credentials are present locally; it does not prove they still refresh or that every collection file is available. A previous Premium observation is dated, not a permanent account guarantee.

Recheck every tracked snapshot's inventory and bytes with:

```powershell
pnpm run setup -- --status --verify
```

Missing or altered snapshots fail verification. Setup never repairs them or treats a partial copy as valid. Rerun setup to register another clean snapshot; existing copies and failed-run evidence remain.

Choices live in the gitignored `harness/.cache/benchmark-setup.json`. Keep that file local. The checked-in case catalog remains shared; your paths and login do not belong in it.

## Run the prepared collection

For example, after preparing base GTS:

```powershell
pnpm run benchmark -- --exploratory --repeats=1 --timeout-minutes=360 --select=B1-C2
```

This starts one real Nexus download and installation into a new game copy, with a six-hour operation timeout. Choose a timeout appropriate to your connection. The run rechecks the game files and account, records warnings and saves a result. Exploratory output is a functional check with measurements, not an approved performance baseline.

In a custom TypeScript runner, load the same saved choice:

```typescript title="prepared-collection.ts"
import { preparedCollection } from "./benchmarks/setup";
import { exploratoryManifest } from "./benchmarks/config";

const machine = exploratoryManifest();
export const preparedManifest = {
  ...machine,
  timeoutMs: 6 * 60 * 60 * 1000,
  profile: {
    ...machine.profile,
    account: "premium" as const,
    bandwidth: "Actual test connection; unmeasured",
  },
  collection: preparedCollection("C2"),
};
```

Pass `preparedManifest` to [runBenchmarks](../reference/runner.md#runbenchmarks). For comparisons, record the agreed hardware and connection conditions and budgets in [formal configuration](../testing/benchmarks.md#configure-a-formal-run).
