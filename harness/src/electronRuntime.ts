import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { ConfigError } from "./errors";
import { acquireLease, releaseLease, LeaseHeldError } from "./lease";

/** Configuration is pure: never require Electron's auto-installing module here. */
export function peekDevElectron(mainDir: string): string {
  const require = createRequire(path.join(mainDir, "package.json"));
  const root = path.dirname(require.resolve("electron"));
  const pathFile = path.join(root, "path.txt");
  const name = fs.existsSync(pathFile)
    ? fs.readFileSync(pathFile, "utf8").trim()
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";
  return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH ?? path.join(root, "dist"), name);
}

/** Electron's module can synchronously install its binary. Serialize across CLI processes. */
export function resolveDevElectron(mainDir: string): string {
  const require = createRequire(path.join(mainDir, "package.json"));
  const entry = require.resolve("electron");
  const dir = path.join(path.dirname(entry), ".doodlebot-install");
  const deadline = Date.now() + 5 * 60_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const owner = `electron-${String(process.pid)}`;
  for (;;) {
    try {
      acquireLease("electron-install", owner, { dir });
      break;
    } catch (error) {
      if (!(error instanceof LeaseHeldError)) throw error;
      if (Date.now() >= deadline) {
        throw new ConfigError(
          `Timed out waiting for Electron installation at ${path.dirname(entry)}.`,
        );
      }
      Atomics.wait(pause, 0, 0, 100);
    }
  }
  try {
    const executable = require(entry) as string;
    if (!fs.existsSync(executable)) {
      throw new ConfigError(`Electron did not produce an executable at ${executable}.`);
    }
    return executable;
  } finally {
    releaseLease("electron-install", owner, { dir });
  }
}
