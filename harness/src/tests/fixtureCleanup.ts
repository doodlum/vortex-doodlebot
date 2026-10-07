import type { ChildProcess } from "node:child_process";
import { forgetLaunchedPid, removeInstanceDir } from "../instance";
import { processAlive, type LeaseEnv, type LeaseIdentity } from "../lease";

/** Parent fixtures must not erase a profile retained by a failed child teardown. */
export class FixtureCleanup {
  private failed = false;
  private failure: unknown;

  async preserveOnFailure<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!this.failed) this.failure = error;
      this.failed = true;
      throw error;
    }
  }

  remove(dir: string): void {
    if (this.failed)
      throw new Error(
        `Preserved ${dir} because fixture launch or shutdown failed; inspect the running app before cleanup.`,
        { cause: this.failure },
      );
    removeInstanceDir(dir);
  }
}

export async function closeFixtureApp(
  app: { close(): Promise<void>; process(): ChildProcess },
  leases: readonly LeaseIdentity[],
  cleanup: FixtureCleanup,
  env: LeaseEnv = {},
): Promise<void> {
  await cleanup.preserveOnFailure(async () => {
    const child = app.process();
    await app.close();
    if (child.pid !== undefined) {
      if ((env.isAlive ?? processAlive)(child.pid))
        throw new Error(
          `Vortex ${child.pid} is still running after fixture close; ownership and profile retained.`,
        );
      forgetLaunchedPid(leases, child.pid, env);
    } else if (child.exitCode === null && child.signalCode === null) {
      throw new Error("Fixture close did not confirm Vortex exit; profile retained.");
    }
  });
}
