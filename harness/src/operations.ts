/** Full-duration process exclusion, separate from persistent human-readable owner leases. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ConfigError } from "./errors";
import {
  addHolder,
  dropHolder,
  holdLease,
  readLease,
  requireNamedOwner,
  type HoldResult,
  type LeaseEnv,
  type LeaseIdentity,
} from "./lease";

export const CONTEXT_ENV = "VORTEX_AI_OPERATION_CONTEXT";
const contextSchema = z.strictObject({
  id: z.string().uuid(),
  owner: z.string().min(1),
  resources: z.array(z.string().min(1)).min(1),
});
export type OperationContext = Readonly<z.infer<typeof contextSchema>>;
export interface OperationOptions {
  context?: OperationContext;
  leaseEnv?: LeaseEnv;
}
export const operationResource = (resource: string): string => `operation:${resource}`;

/** Only explicitly composed child commands receive this context. */
export function inheritedOperation(
  owner: string,
  env: NodeJS.ProcessEnv = process.env,
  leaseEnv: LeaseEnv = {},
): OperationContext | undefined {
  const raw = env[CONTEXT_ENV];
  if (raw === undefined) return undefined;
  const context = contextSchema.parse(JSON.parse(raw));
  assertContext(context, owner, leaseEnv);
  return context;
}

function assertContext(context: OperationContext, owner: string, env: LeaseEnv): void {
  if (context.owner !== owner)
    throw new ConfigError("Execution context belongs to a different owner.");
  for (const resource of context.resources) {
    const state = readLease(operationResource(resource), env);
    if (state?.live !== true || state.lease.owner !== context.id)
      throw new ConfigError(
        `Execution context is no longer active for ${resource}; do not silently restart interrupted work.`,
      );
  }
}

export interface OperationHold {
  context: OperationContext;
  release(): void;
  trackChild(pid: number): () => void;
}

/** No waits while holding resources: failed partial acquisitions release before retry. */
export function claimOperations(
  resources: readonly string[],
  ownerFlag: string,
  options: OperationOptions = {},
): OperationHold {
  const owner = requireNamedOwner(ownerFlag);
  const env = options.leaseEnv ?? {};
  const inherited = options.context;
  if (inherited !== undefined) assertContext(inherited, owner, env);
  const context: OperationContext = {
    id: inherited?.id ?? randomUUID(),
    owner,
    resources: [...new Set([...(inherited?.resources ?? []), ...resources])].toSorted(),
  };
  const held: HoldResult[] = [];
  try {
    for (const resource of [...new Set(resources)].toSorted()) {
      held.push(
        holdLease(operationResource(resource), context.id, {
          ...env,
          purpose: `${owner}: ${resource}`,
        }),
      );
    }
  } catch (error) {
    for (const hold of held.toReversed()) hold.release();
    throw error;
  }
  return {
    context,
    release: () => {
      for (const hold of held.toReversed()) hold.release();
    },
    trackChild: (pid) => trackOperationChild(context, pid, [], env),
  };
}

/** Retain operation and ownership leases for an immediate known child until confirmed exit. */
export class ChildRegistrationError extends ConfigError {
  constructor(
    cause: unknown,
    readonly release: () => void,
  ) {
    super("Child registration failed; await confirmed child exit before releasing protection.", {
      cause,
    });
  }
}

export function trackOperationChild(
  context: OperationContext,
  pid: number,
  persistent: readonly string[] = [],
  env: LeaseEnv = {},
): () => void {
  const registered: LeaseIdentity[] = [];
  const release = (): void => {
    const failures: unknown[] = [];
    for (const record of registered) {
      try {
        dropHolder(record.resource, pid, env, record.acquisitionId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Child exited, but lease cleanup failed; inspect recovery state.",
      );
  };
  try {
    assertContext(context, context.owner, env);
    const operationResources = new Set(context.resources.map(operationResource));
    const records = [...new Set([...operationResources, ...persistent])].map((resource) => {
      const state = readLease(resource, env);
      const owner = operationResources.has(resource) ? context.id : context.owner;
      if (state?.live !== true || state.lease.owner !== owner)
        throw new ConfigError(`Cannot register child on absent or replaced ${resource}.`);
      return { resource, owner, acquisitionId: state.lease.acquisitionId };
    });
    for (const record of records) {
      // Retain partial registration bookkeeping even if a filesystem write fails.
      registered.push(record);
      addHolder(record, pid, env);
    }
    return release;
  } catch (error) {
    throw new ChildRegistrationError(error, release);
  }
}

export async function withOperations<T>(
  resources: readonly string[],
  owner: string,
  options: OperationOptions,
  fn: (context: OperationContext) => Promise<T>,
): Promise<T> {
  const hold = claimOperations(resources, owner, options);
  try {
    return await fn(hold.context);
  } finally {
    hold.release();
  }
}

export function withOperationsSync<T>(
  resources: readonly string[],
  owner: string,
  options: OperationOptions,
  fn: (context: OperationContext) => T,
): T {
  const hold = claimOperations(resources, owner, options);
  try {
    return fn(hold.context);
  } finally {
    hold.release();
  }
}
