# Write a unit test

Use Vitest for logic that does not need Vortex: parsing, statistics, input validation, and pure DOM helpers. Test the behavior your caller relies on, including a useful failure case.

```typescript title="harness/src/my-parser.test.ts"
import { expect, it } from "vitest";
import { parseCollectionRef } from "./collections";

it("keeps a pinned collection revision", () => {
  expect(parseCollectionRef("nxm://skyrimse/collections/example/revisions/7")).toEqual({
    gameId: "skyrimse",
    slug: "example",
    revision: 7,
  });
});
```

`example` is test input for the parser; it is not a real collection to download.

Run `pnpm exec vitest run harness/src/my-parser.test.ts`. The full unit suite is `pnpm run test`.

DOM logic belongs with the extension's jsdom tests. A simulated DOM can check a selector or transformation, but cannot prove that a current Vortex screen has the expected control. Use [a real-app test](integration.md) for that contract.

For collection startup, run `pnpm exec vitest run src/uiAutomation.test.ts harness/src/collectionStartup.test.ts`. These tests cover a large page whose snapshot stops before the dialog, Vortex's nested dialog wrappers, two separate dialogs with identical text, one successful **Install Now** click, and failures without another click. They need neither a game nor a Nexus account; they do not install a real collection.

The DOM click tests also check buttons that change their label or role during the action. The click result must describe the original target so a successful transition to another dialog step does not look like a wrong click.

When changing measurements, test the timing arithmetic and status handling with unit tests, then verify the actual app action separately.

Run `pnpm exec vitest run harness/benchmarks/stagingIntegrity.test.ts` to check collection staging validation. It needs no Vortex, game or account. The tests use real temporary directories with mocked Vortex state, UI and timing recorder. They check that missing or unsafe staging fails before cleanup, and that both timing routes reject failed validation without counting validation time. They do not install a real collection or measure native phases.

After installing the repository dependencies, run `pnpm exec vitest run harness/src/bootstrap.test.ts` to check cold game setup. It needs no Vortex, game or account. Mocked app launches and temporary profile directories check that setup saves the private path before native game startup, waits for activation, rejects a changed path or conflicting startup flags, and does not cache a profile after failed activation or shutdown. The tests also retain both setup and cleanup errors. Verify actual staging initialization and install/deploy/purge separately with the [real-app suite](integration.md).

Run `pnpm exec vitest run harness/src/runningVortex.test.ts harness/src/config.test.ts harness/src/processRunner.test.ts` to check how Doodlebot keeps to one Vortex at a time. They need no Vortex, game or account. A temporary cache folder stands in for `harness/.cache`. The tests check that the record of the running Vortex is read, written and cleared correctly, that a record whose process has exited or now belongs to another program is treated as stale, that both "A harness Vortex is running" refusals use their exact wording, that the default cache, artifact folder and ports apply unless overridden, and that `script` runs in the directory you started it from and returns the script's exit code, or 130 after Ctrl+C. They do not start Vortex; the [real-app suite](integration.md) checks a real launch and shutdown.

`pnpm exec vitest run harness/src/singleInstance.test.ts` searches every file in the repository for the names of commands, flags and settings that older versions used to run several instances at once, and fails if any remain outside a short list of allowed files. Run it after you edit documentation or harness code.

Run `pnpm exec vitest run harness/src/design.test.ts harness/src/designCommand.test.ts harness/src/egmResources.test.ts` for the design-first workflow. They need no Vortex and no coding-agent plugin. `designCommand.test.ts` builds a temporary Git repository and checks that `design new`, `design check` and `design scope` write, validate and refuse as documented in [Review and approve a design](../guides/design-review.md). `egmResources.test.ts` checks that the plugin pin and review resources the setup guide relies on are present. They do not prove that your coding agent loads the plugin; check that yourself with [the plugin setup guide](../guides/agent-plugins.md).

Run `pnpm exec vitest run harness/src/gameStartup.test.ts` for the activation dialog watcher. It uses the actual startup and dialog helpers with mocked transport and clocks. It checks that a failed dialog request stops polling, waits for an in-flight native query to settle, and preserves separate UI and watcher failures. It does not launch Vortex or prove that a real game's activation completes.
