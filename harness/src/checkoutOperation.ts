import { ConfigError } from "./errors";
import { checkoutResource, readLease, processAlive, requireNamedOwner, withLeases } from "./lease";
import {
  inheritedOperation,
  withOperations,
  type OperationContext,
  type OperationOptions,
} from "./operations";

/** Shared install/build/launch exclusion. Build validation occurs only inside the guard. */
export async function withCheckoutOperation<T>(
  dir: string,
  ownerFlag: string | undefined,
  purpose: string,
  options: OperationOptions & { rewriting?: boolean },
  fn: (context: OperationContext) => Promise<T>,
): Promise<T> {
  const owner = requireNamedOwner(ownerFlag);
  const resource = checkoutResource(dir);
  return withLeases([resource], owner, { ...options.leaseEnv, purpose }, () =>
    withOperations(
      [resource],
      owner,
      {
        ...options,
        context: options.context ?? inheritedOperation(owner, process.env, options.leaseEnv),
      },
      async (context) => {
        if (options.rewriting === true) {
          const running =
            readLease(resource, options.leaseEnv)?.lease.instancePids.filter(
              options.leaseEnv?.isAlive ?? processAlive,
            ) ?? [];
          if (running.length > 0)
            throw new ConfigError(
              `A Vortex (pid ${running.join(", ")}) is running from ${dir}; stop it with its owner and slot before install/build.`,
            );
        }
        return fn(context);
      },
    ),
  );
}
