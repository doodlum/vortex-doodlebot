import path from "node:path";
import type { HarnessConfig } from "./config";
import { ConfigError } from "./errors";
import { normalizedPath } from "./lease";
import { VortexMcpClient } from "./mcpClient";

export class ProfileMismatchError extends ConfigError {}
export interface AutomationProfile {
  userDataDir: string;
  runtimeId?: unknown;
}

export function expectedUserDataDir(config: Pick<HarnessConfig, "cacheDir">): string {
  return path.join(config.cacheDir, "live", "userData");
}

/** A reachable endpoint or changed runtime ID alone does not identify the guarded profile. */
export function assertAutomationProfile(
  status: unknown,
  expected: string,
): asserts status is AutomationProfile {
  if (
    status === null ||
    typeof status !== "object" ||
    !("userDataDir" in status) ||
    typeof status.userDataDir !== "string" ||
    !path.isAbsolute(status.userDataDir) ||
    normalizedPath(status.userDataDir) !== normalizedPath(expected)
  )
    throw new ProfileMismatchError(
      `The MCP endpoint does not identify the expected isolated profile ${expected}. Check the cache, slot and port before driving it.`,
    );
}

export async function readAutomationProfile(
  mcp: Pick<VortexMcpClient, "call">,
  expected: string,
  timeoutMs = 3_000,
): Promise<AutomationProfile> {
  const status = await mcp.call("automation_status", {}, timeoutMs);
  assertAutomationProfile(status, expected);
  return status;
}

/** Shared CLI attachment; callers hold the configured live operation before entering. */
export async function requireRunning(
  config: HarnessConfig,
  mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken }),
): Promise<VortexMcpClient> {
  try {
    await readAutomationProfile(mcp, expectedUserDataDir(config));
  } catch (cause) {
    if (cause instanceof ProfileMismatchError) throw cause;
    throw new ConfigError(
      `No matching Vortex instance is answering on ${mcp.url}. Start the owned instance with the same target/cache/slot flags (pnpm run ai:up), or run doodlebot doctor.`,
      { cause },
    );
  }
  return mcp;
}
