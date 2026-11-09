import type { ChildProcess } from "node:child_process";
import { removeInstanceDir } from "../instance";
import { processAlive } from "../processes";
import { clearInstanceRecord } from "../runningVortex";

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
        `Preserved ${dir} because fixture validation, launch or shutdown failed; inspect its evidence and any running app before cleanup.`,
        { cause: this.failure },
      );
    removeInstanceDir(dir);
  }
}

/**
 * Close the fixture's Vortex and confirm it exited. Only a confirmed exit clears the
 * instance record; a live or unconfirmed app keeps the record and its profile.
 */
export async function closeFixtureApp(
  app: { close(): Promise<void>; process(): ChildProcess },
  cleanup: FixtureCleanup,
  isAlive: (pid: number) => boolean = processAlive,
): Promise<void> {
  await cleanup.preserveOnFailure(async () => {
    const child = app.process();
    await app.close();
    if (child.pid !== undefined) {
      if (isAlive(child.pid))
        throw new Error(
          `Vortex ${child.pid} is still running after fixture close; profile retained.`,
        );
      clearInstanceRecord(child.pid);
    } else if (child.exitCode === null && child.signalCode === null) {
      throw new Error("Fixture close did not confirm Vortex exit; profile retained.");
    }
  });
}
