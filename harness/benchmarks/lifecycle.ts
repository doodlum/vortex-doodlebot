import { BenchmarkBlocked } from "./types";
import type { BenchmarkSession } from "./session";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Report every failure while retaining the original exception as the cause. */
export function retainedFixtureError(error: unknown, cacheDir: string, cleanup?: unknown): Error {
  const retained = `Fixture preserved at ${cacheDir}`;
  if (cleanup !== undefined)
    return new AggregateError(
      [error, cleanup],
      `${describe(error)}; teardown also failed: ${describe(cleanup)}; ${retained}`,
      { cause: error },
    );
  if (error instanceof BenchmarkBlocked)
    return new BenchmarkBlocked(`${describe(error)}; ${retained}`, { cause: error });
  return new Error(`${describe(error)}; ${retained}`, { cause: error });
}

/** Keep lifecycle logic independently testable without starting an application. */
export async function runInSession<T>(
  session: BenchmarkSession,
  run: (vortex: BenchmarkSession) => Promise<T>,
): Promise<T> {
  let callbackFailed = false;
  let callbackError: unknown;
  let result: T | undefined;
  try {
    result = await run(session);
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }
  try {
    await session.close(callbackFailed);
  } catch (cleanupError) {
    throw callbackFailed
      ? retainedFixtureError(callbackError, session.config.cacheDir, cleanupError)
      : retainedFixtureError(cleanupError, session.config.cacheDir);
  }
  if (callbackFailed) throw retainedFixtureError(callbackError, session.config.cacheDir);
  return result as T;
}
