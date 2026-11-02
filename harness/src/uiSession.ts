import { AsyncLocalStorage } from "node:async_hooks";
import type { VortexMcpClient } from "./mcpClient";

const owners = new AsyncLocalStorage<VortexMcpClient>();
const queues = new WeakMap<VortexMcpClient, Promise<unknown>>();

/** Keep snapshots serialized. A signal cancels acquisition, never the current holder's action. */
export async function withUiLock<T>(
  mcp: VortexMcpClient,
  action: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (owners.getStore() === mcp) return action();
  const previous = queues.get(mcp) ?? Promise.resolve();
  let started = false;
  const result = previous
    .catch(() => undefined)
    .then(() => {
      signal?.throwIfAborted();
      started = true;
      return owners.run(mcp, action);
    });
  queues.set(
    mcp,
    result.catch(() => undefined),
  );
  if (signal === undefined) return result;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      if (!started) reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    result.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) onAbort();
  });
}
