import type { HarnessConfig } from "./config";
import { attachedLeaseResources, instanceLeaseResources } from "./instance";
import { requireNamedOwner, withLeases } from "./lease";
import {
  inheritedOperation,
  withOperations,
  type OperationContext,
  type OperationOptions,
} from "./operations";

export const LIVE_COMMANDS = new Set([
  "up",
  "down",
  "bootstrap",
  "setup",
  "save-login",
  "login-import",
  "install",
  "slow-download",
  "auth-status",
  "call",
  "tools",
  "snapshot",
  "click",
  "fill",
  "press",
  "responsive",
  "record",
  "screenshot",
  "collection",
  "deploy",
  "purge",
  "e2e",
  "eval",
  "script",
]);

/** Every supported live CLI path enters before ping, snapshot, CDP or profile mutation. */
export async function withLiveOperation<T>(
  config: HarnessConfig,
  purpose: string,
  fn: (context: OperationContext) => Promise<T>,
  options: OperationOptions = {},
): Promise<T> {
  const owner = requireNamedOwner(config.owner);
  const resources = [
    ...new Set([...attachedLeaseResources(config), ...instanceLeaseResources(config)]),
  ];
  return withLeases(resources, owner, { ...options.leaseEnv, purpose }, () =>
    withOperations(
      resources,
      owner,
      {
        ...options,
        context: options.context ?? inheritedOperation(owner, process.env, options.leaseEnv),
      },
      fn,
    ),
  );
}
