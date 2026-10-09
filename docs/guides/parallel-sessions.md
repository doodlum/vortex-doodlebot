# Run more than one scenario

Run performance scenarios sequentially. Competing CPU, disk, and network work can change both results.

```typescript title="two-scenarios.mts"
import { withVortex } from "./harness/benchmarks/index";

for (const count of [150, 570]) {
  await withVortex({}, async (vortex) => {
    await vortex.seedMods(count);
    await vortex.openPage("Mods");
    console.log("Prepared scenario", count);
  });
}
```

Run `pnpm exec tsx two-scenarios.mts`. Each scenario gets a fresh disposable app. For measured repeats and one combined report, put the scenarios into [benchmark cases](../testing/adding-benchmarks.md).

The lower-level harness also supports numbered slots for independent interactive sessions. Slots select separate profiles, artifact directories, and ports. That is an advanced setup option in the [CLI reference](../reference/cli.md).

Separate profiles must also use separate game directories when deploying. Two instances writing to one fixture invalidate the starting state and can overwrite each other's deployment.
