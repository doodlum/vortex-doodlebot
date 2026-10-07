/**
 * Hold the machine-wide instance lease for a whole `ai:test` run (see lease.ts).
 *
 * Runs in Playwright's runner process, which outlives every worker, so another agent
 * cannot take the instance between one worker's exit and the next one's launch. Workers
 * join it (same owner) through the fixtures. The owner is VORTEX_AI_OWNER, which
 * `doodlebot lease run --owner <name> -- pnpm run ai:test` sets.
 */
import { loadConfig } from "../config";
import { claimInstanceLease } from "../instance";
import { CONTEXT_ENV } from "../operations";

export default function globalSetup(): () => void {
  // A recorded test run owns independent fixture operations; its parent retains its child hold.
  delete process.env[CONTEXT_ENV];
  const lease = claimInstanceLease(loadConfig(), "ai:test");
  return () => lease.release();
}
