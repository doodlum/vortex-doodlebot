import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { ConfigError } from "./errors";

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

/** Electron's module installs its binary, synchronously, when it is missing. */
export function resolveDevElectron(mainDir: string): string {
  const require = createRequire(path.join(mainDir, "package.json"));
  const executable = require(require.resolve("electron")) as string;
  if (!fs.existsSync(executable)) {
    throw new ConfigError(`Electron did not produce an executable at ${executable}.`);
  }
  return executable;
}
