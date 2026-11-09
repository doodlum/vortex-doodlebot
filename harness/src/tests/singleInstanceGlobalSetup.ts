/**
 * Refuse a Playwright run while the one harness Vortex is running (see runningVortex.ts).
 *
 * Runs once in Playwright's runner process before any worker launches, so the fixtures,
 * which write the instance record for each launch, do not refuse again inside the suite.
 */
import { assertNoHarnessVortex } from "../runningVortex";

export default function globalSetup(): void {
  assertNoHarnessVortex("the core suite");
}
