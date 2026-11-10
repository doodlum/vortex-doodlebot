/**
 * `doodlebot fixture mod --out <zip> [--name <text>]`: a tiny mod archive for install and deploy
 * checks. It holds one file, `textures/<name>.txt`, whose content is `<name>`; in the sandbox it
 * deploys to `<gamePath>/Data/textures/<name>.txt`.
 */
import fs from "node:fs";
import path from "node:path";

import { strToU8, zipSync } from "fflate";

import { ConfigError } from "./errors";

export const DEFAULT_FIXTURE_NAME = "automation-probe";

export function writeModFixture(out: string, name: string = DEFAULT_FIXTURE_NAME): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
    throw new ConfigError(
      `--name ${JSON.stringify(name)}: use letters, digits, ".", "_" or "-" (it names a file).`,
    );
  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipSync({ [`textures/${name}.txt`]: strToU8(name) }));
  return file;
}

export function fixtureCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): string {
  if (positional[0] !== "mod")
    throw new ConfigError("Use fixture mod --out <zip> [--name <text>].");
  if (typeof flags.out !== "string") throw new ConfigError("fixture mod needs --out <zip>.");
  const name = typeof flags.name === "string" ? flags.name : DEFAULT_FIXTURE_NAME;
  const file = writeModFixture(flags.out, name);
  return `fixture: ${file} (textures/${name}.txt)`;
}
