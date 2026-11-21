import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ConfigError, type HarnessConfig } from "./config";

const execute = promisify(execFile);
const credentials = "confidential.account.nexus.OAuthCredentials";

/**
 * Vortex starts its Nexus client from persisted state before the Doodlebot extension restores
 * the shared OAuth cache. An older profile can therefore spend a refresh token or have an
 * already-spent token refused while the new session is being restored.
 */
export async function removePersistedOAuthBeforeLaunch(
  config: Pick<HarnessConfig, "cacheDir" | "target">,
  env: Record<string, string>,
): Promise<void> {
  const dataDir = env.ELECTRON_USERDATA;
  const cacheFile = env.VORTEX_AI_AUTH_CACHE;
  if (dataDir === undefined || cacheFile === undefined || !fs.existsSync(cacheFile)) return;
  const stateDir = path.join(dataDir, "state.v2");
  if (!fs.existsSync(stateDir)) return;

  const relative = path.relative(config.cacheDir, stateDir);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ConfigError("OAuth startup cleanup requires a database inside the test cache.");
  }
  const canonicalState = fs.realpathSync(stateDir);
  const expectedState = path.join(fs.realpathSync(config.cacheDir), relative);
  if (path.relative(expectedState, canonicalState) !== "") {
    throw new ConfigError("OAuth startup cleanup cannot use a redirected test database.");
  }
  const verifiedDataDir = path.dirname(canonicalState);

  // Use the stock Vortex state command. Only the key name leaves this process.
  const { target } = config;
  const args = target.kind === "dev" ? target.args.slice(0, 1) : [];
  const { VORTEX_MCP_TOKEN: _mcpToken, VORTEX_AI_AUTH_CACHE: _authCache, ...helperEnv } = env;
  helperEnv.ELECTRON_USERDATA = verifiedDataDir;
  try {
    const { stderr } = await execute(
      target.executable,
      [...args, "--user-data", verifiedDataDir, "--del", credentials],
      { env: helperEnv, cwd: path.dirname(target.executable), timeout: 30_000, windowsHide: true },
    );
    // Some Vortex versions report state-command failures on stderr before quitting normally.
    if (stderr.trim() !== "") throw new Error("Vortex reported a state cleanup error");
  } catch {
    // The child logs are deliberately excluded: the helper touches confidential state.
    throw new ConfigError(
      "Could not clear copied OAuth credentials from the test profile before startup.",
    );
  }
}
