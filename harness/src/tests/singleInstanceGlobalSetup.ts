/**
 * Refuse a Playwright run while the one harness Vortex is running (see runningVortex.ts), while
 * the owner's own Vortex runs (ownVortex.ts), or while a user-folder restore is pending
 * (userFolders.ts).
 *
 * Runs once in Playwright's runner process before any worker launches, so the fixtures,
 * which write the instance record for each launch, do not refuse again inside the suite.
 */
import { assertNoOwnVortex } from "../ownVortex";
import { assertNoHarnessVortex } from "../runningVortex";
import { assertNoPendingRestore } from "../userFolders";

export default function globalSetup(): void {
  assertNoHarnessVortex("the core suite");
  assertNoOwnVortex();
  assertNoPendingRestore();
}
