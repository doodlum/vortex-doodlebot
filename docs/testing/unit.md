# Write unit tests

Use unit tests for pure logic, DOM behavior and filesystem/process behavior you can exercise
with temporary fixtures. Installation, deployment and behavior that needs Electron belong
in the real-app test layer.

## A small DOM test

Extension DOM tests use Vitest with jsdom. Keep a test beside the module it exercises, and
follow the existing `src/uiAutomation.test.ts` setup for mocked Vortex imports and DOM state.
For a pure helper, start with:

```typescript
import { describe, expect, it } from "vitest";
import { yourFunction } from "./yourModule";

describe("yourFunction", () => {
  it("reports the user-visible boundary condition", () => {
    expect(yourFunction(/* meaningful fixture */)).toEqual(/* expected result */);
  });
});
```

This is a template, not a runnable test until you replace the function, fixture and assertion.
Choose a result the caller relies on. Repeating the implementation's formula or only checking
that a mock was called can miss a bug in the behavior that matters.

## A runnable snapshot-query example

For a harness-only example, save this as a new `.test.ts` beside the helper tests:

```typescript title="Runnable snapshot test"
import { expect, it } from "vitest";
import { findOne, type Snapshot } from "./uiDriver";

it("refuses an ambiguous visible button label", () => {
  const snap: Snapshot = {
    generation: 1,
    title: "fixture",
    viewport: { width: 1280, height: 720 },
    nodeCount: 2,
    truncated: false,
    activeDialogs: [],
    tree: [
      { ref: "e1", role: "button", name: "Install" },
      { ref: "e2", role: "button", name: "Install" },
    ],
  };
  expect(() => findOne(snap, { role: "button", name: "Install" })).toThrow(/Ambiguous UI target/);
});
```

Run the new file with `pnpm exec vitest run <path-to-your.test.ts>`, then `pnpm run ci`.
The assertion checks that an ambiguous label produces an error instead of silently choosing
one of the two buttons.

## Filesystem and process tests

Use temporary repositories, profiles and processes, with an isolated lease directory and
synthetic credentials. Test changes and restoration in those fixtures rather than a person's
Vortex checkout or cached OAuth. Where relevant, check that cleanup waits for confirmed exit,
protection remains after interruption or failed shutdown, and original failures are preserved.

## Controls for bug fixes

Run the test without the fix and check that it fails at the intended assertion. A missing
module, failed compile, setup error or unrelated timeout leaves that question unanswered.
Restore the checkout afterward and retain the original outcomes. For a feature, test the
missing behavior or wiring; for a refactor, check that callers still receive the same behavior.

Update human instructions and the paired AI reference/manual alongside an interface,
fixture or workflow change. [Documentation checks](../maintaining-documentation.md) cover
inventory drift and changed companion files; review still checks correctness.
