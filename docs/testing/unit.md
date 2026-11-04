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

Run `pnpm exec vitest run harness/src/gameSetup.test.ts` after installing dependencies to
check game-path and store registration. Real temporary Steam manifests and directories
cover secondary libraries, native and Windows executables, standalone manual games, and
copies that must not inherit Steam identity. MCP calls are mocked: these tests need no
Vortex or account and do not prove INI or LOOT initialization. Inspect the registered store
and resolved user folders in the running app for that contract.

After installing the repository dependencies, run `pnpm exec vitest run src/mcpServer.test.ts`
to check the MCP HTTP boundary and resolved-folder diagnostics. Distinct mocked Vortex paths
verify Home, AppData, Documents and LocalAppData responses; a failed lookup returns null
without losing the other folders. No app, game or account is needed. This does not prove
filesystem isolation: inspect the [running app's resolved folders](../guides/calling-tools.md#inspect-resolved-folders)
and their physical targets before managing a game.

That HTTP suite also checks `game_store_entry` with mocked catalogs: store-ID forwarding,
installation and optional Proton fields, native false, omitted account/plugin data, catalog
errors and an unavailable API. It does not prove real Steam discovery or a working prefix;
inspect the [running store entry](../guides/calling-tools.md#inspect-a-store-installation)
separately before a game workflow.

DOM logic belongs with the extension's jsdom tests. A simulated DOM can check a selector or transformation, but cannot prove that a current Vortex screen has the expected control. Use [a real-app test](integration.md) for that contract.

For collection startup, run `pnpm exec vitest run src/uiAutomation.test.ts harness/src/collectionStartup.test.ts`. These tests cover a large page whose snapshot stops before the dialog, Vortex's nested dialog wrappers, two separate dialogs with identical text, one successful **Install Now** click, and failures without another click. They need neither a game nor a Nexus account; they do not install a real collection.

The DOM click tests also check buttons that change their label or role during the action. The click result must describe the original target so a successful transition to another dialog step does not look like a wrong click.

Run `pnpm exec vitest run harness/src/uiDriver.test.ts` for scoped dialog selection.
Fixtures include a confirmation after four or eight unrelated modal containers, a hidden
empty container before the target, and an absent target. Helpers inspect the matching set
without clicking another dialog's button. These mocked transport checks need no app or
account; verify a real stacked-dialog workflow separately.

When changing measurements, test the timing arithmetic and status handling with unit tests, then verify the actual app action separately.

Run `pnpm exec vitest run harness/benchmarks/stagingIntegrity.test.ts` to check collection staging validation. It needs no Vortex, game or account. The tests use real temporary directories with mocked Vortex state, UI and timing recorder. They check that missing or unsafe staging fails before cleanup, and that both timing routes reject failed validation without counting validation time. They do not install a real collection or measure native phases.

After installing the repository dependencies, run `pnpm exec vitest run harness/src/bootstrap.test.ts` to check cold game setup. It needs no Vortex, game or account. Mocked app launches and temporary profile directories check that setup saves the private path before native game startup, waits for activation, rejects a changed path or conflicting startup flags, and does not cache a profile after failed activation or shutdown. The tests also retain both setup and cleanup errors. Verify actual staging initialization and install/deploy/purge separately with the [real-app suite](integration.md).

Run `pnpm exec vitest run harness/src/gameStartup.test.ts` for the activation dialog watcher. It uses the actual startup and dialog helpers with mocked transport and clocks. It checks that a failed dialog request stops polling, waits for an in-flight native query to settle, and preserves separate UI and watcher failures. It does not launch Vortex or prove that a real game's activation completes.

After installing the repository dependencies, run `pnpm exec vitest run harness/src/instance.test.ts harness/src/mainPreload.test.ts` to check isolated-path startup diagnostics. It needs Node but no Vortex, game or account. The launcher starts a real Node child that writes a startup error to stderr and exits with code 23. The test checks that the resulting error reports that status and the retained log path, keeps the original preload error as its cause, and preserves the stderr content. Separate preload fixtures check applied, rejected and absent path records. These checks do not verify Electron sandbox configuration or a successful GUI launch; use the [real-app suite](integration.md) for those runtime contracts.

After installing the repository dependencies, run `pnpm exec vitest run src/vortexControl.test.ts src/linuxProcess.test.ts` to check game launch responses and process lookup. Mocked Vortex calls check return after a valid spawn, failures before and after spawn, pending-command suppression, working-directory defaults/overrides and dead-loader fallback. A real copied Node executable stays alive after a mocked launch completes, checking that an active detached loader prevents a second launch on both hosts.

Linux also starts and cleans up owned Node children: a long process name checks that lookup prevents a duplicate fallback, and a temporary copy of the runtime checks native executable identity after its main thread is renamed. Windows skips those two Linux-only cases. Pure matching cases cover truncated names, Windows filename case and unrelated interpreter arguments. Flatpak routing cases mock the host command boundary and check literal arguments, a working directory available to both app and host, explicit absence, and observation errors. They need no Flatpak or Python.

These checks need no game, account, Vortex or compiler. They do not prove real Flatpak host visibility or a rendered Proton game. Verify the observer inside an actual registered Flatpak with host access and Python 3.10 or newer, against a known live host process and after its exit. Verify a new game process and window separately.
