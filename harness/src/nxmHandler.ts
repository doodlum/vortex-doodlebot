/**
 * The `nxm://` link handler. Every Vortex the kit launches registers itself as the handler in
 * `HKCU\Software\Classes\nxm`, extracted release or not (the step 1 spike). So each launch records
 * the handler's command in the instance record, and the confirmed end of that Vortex writes it
 * back: `down`, the restart path, a cold phase's stop, and the next command that finds the record
 * stale after a crash (runningVortex.ts).
 */
import { execFileSync } from "node:child_process";

export const NXM_KEY = "HKCU\\Software\\Classes\\nxm";
export const NXM_COMMAND_KEY = `${NXM_KEY}\\shell\\open\\command`;

/** What a launch saw: the command's default value, or absent when there was no nxm key at all. */
export type NxmHandler = { command: string } | { absent: true };

/** Registry access, injected in tests. */
export interface NxmRegistry {
  /** Whether a key exists. */
  exists(key: string): boolean;
  /** A key's default value, or undefined when the key or the value is missing. */
  readDefault(key: string): string | undefined;
  writeDefault(key: string, value: string): void;
  deleteKey(key: string): void;
}

function reg(args: string[]): string {
  return execFileSync("reg", args, { encoding: "utf8", windowsHide: true, stdio: "pipe" });
}

/** The real registry through `reg.exe`. */
export const windowsRegistry: NxmRegistry = {
  exists(key) {
    try {
      reg(["query", key]);
      return true;
    } catch {
      return false;
    }
  },
  readDefault(key) {
    let output: string;
    try {
      output = reg(["query", key, "/ve"]);
    } catch {
      return undefined;
    }
    // "    (Default)    REG_SZ    <value>"; reg separates the columns with four spaces.
    const match = /^ {4}.*? {4}REG_(?:EXPAND_)?SZ {4}(.*)$/m.exec(output);
    return match?.[1]?.replace(/\r$/, "");
  },
  writeDefault(key, value) {
    reg(["add", key, "/ve", "/d", value, "/f"]);
  },
  deleteKey(key) {
    reg(["delete", key, "/f"]);
  },
};

/**
 * The registry the kit uses: the real one on Windows, none elsewhere. Unit tests never reach the
 * owner's registry; they inject their own.
 */
export function defaultRegistry(): NxmRegistry | undefined {
  return process.platform === "win32" && process.env.VITEST === undefined
    ? windowsRegistry
    : undefined;
}

export function readNxmHandler(registry = defaultRegistry()): NxmHandler | undefined {
  if (registry === undefined) return undefined;
  if (!registry.exists(NXM_KEY)) return { absent: true };
  return { command: registry.readDefault(NXM_COMMAND_KEY) ?? "" };
}

/**
 * Put the handler back as `saved` recorded it. Returns whether anything was written: nothing is
 * when the registry already matches.
 */
export function restoreNxmHandler(saved: NxmHandler, registry = defaultRegistry()): boolean {
  if (registry === undefined) return false;
  if ("absent" in saved) {
    if (!registry.exists(NXM_KEY)) return false;
    registry.deleteKey(NXM_KEY);
    return true;
  }
  if (registry.readDefault(NXM_COMMAND_KEY) === saved.command) return false;
  registry.writeDefault(NXM_COMMAND_KEY, saved.command);
  return true;
}

/** `restoreNxmHandler` for a stop that must not fail on it: a failure is reported, with the fix. */
export function restoreNxmHandlerOrWarn(
  saved: NxmHandler,
  registry = defaultRegistry(),
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): void {
  try {
    restoreNxmHandler(saved, registry);
  } catch (error) {
    const fix =
      "absent" in saved
        ? `reg delete "${NXM_KEY}" /f`
        : `reg add "${NXM_COMMAND_KEY}" /ve /d "${saved.command.replace(/"/g, '\\"')}" /f`;
    warn(
      `warning: could not restore the nxm link handler (${error instanceof Error ? error.message : String(error)}). Restore it with: ${fix}`,
    );
  }
}
