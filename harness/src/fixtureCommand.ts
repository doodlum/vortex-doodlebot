/**
 * `doodlebot fixture mod --out <zip> [--name <text>]`: a tiny mod archive for install and deploy
 * checks. It holds one file, `textures/<name>.txt`, whose content is `<name>`; in the sandbox it
 * deploys to `<gamePath>/Data/textures/<name>.txt`.
 *
 * `doodlebot fixture fomod --out <zip> [--name <text>]`: a FOMOD installer archive with one
 * install step and one option, so `install` opens Vortex's installer dialog and keeps it open
 * until it is answered. It installs `textures/<name>.txt` always, and `textures/<name>-option.txt`
 * when the option is chosen.
 */
import fs from "node:fs";
import path from "node:path";

import { strToU8, zipSync } from "fflate";

import { ConfigError } from "./errors";

export const DEFAULT_FIXTURE_NAME = "automation-probe";

function checkName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
    throw new ConfigError(
      `--name ${JSON.stringify(name)}: use letters, digits, ".", "_" or "-" (it names a file).`,
    );
}

function writeZip(out: string, entries: Record<string, Uint8Array>): string {
  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipSync(entries));
  return file;
}

export function writeModFixture(out: string, name: string = DEFAULT_FIXTURE_NAME): string {
  checkName(name);
  return writeZip(out, { [`textures/${name}.txt`]: strToU8(name) });
}

/** The FOMOD installer script: one required file, one step with one optional option. */
export function fomodModuleConfig(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://qconsulting.ca/fo3/ModConfig5.0.xsd">
  <moduleName>${name}</moduleName>
  <requiredInstallFiles>
    <file source="core/textures/${name}.txt" destination="textures/${name}.txt" />
  </requiredInstallFiles>
  <installSteps order="Explicit">
    <installStep name="Choose">
      <optionalFileGroups order="Explicit">
        <group name="Options" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="${name} option">
              <description>Also installs textures/${name}-option.txt.</description>
              <files>
                <file source="option/textures/${name}-option.txt" destination="textures/${name}-option.txt" />
              </files>
              <typeDescriptor>
                <type name="Optional" />
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>
`;
}

export function writeFomodFixture(out: string, name: string = DEFAULT_FIXTURE_NAME): string {
  checkName(name);
  return writeZip(out, {
    "fomod/info.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<fomod>\n  <Name>${name}</Name>\n  <Version>1.0.0</Version>\n</fomod>\n`,
    ),
    "fomod/ModuleConfig.xml": strToU8(fomodModuleConfig(name)),
    [`core/textures/${name}.txt`]: strToU8(name),
    [`option/textures/${name}-option.txt`]: strToU8(`${name}-option`),
  });
}

const USAGE = "Use fixture mod|fomod --out <zip> [--name <text>].";

export function fixtureCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
): string {
  const kind = positional[0];
  if (kind !== "mod" && kind !== "fomod") throw new ConfigError(USAGE);
  if (typeof flags.out !== "string") throw new ConfigError(`fixture ${kind} needs --out <zip>.`);
  const name = typeof flags.name === "string" ? flags.name : DEFAULT_FIXTURE_NAME;
  if (kind === "fomod") {
    const file = writeFomodFixture(flags.out, name);
    return `fixture: ${file} (FOMOD installer: one step, option "${name} option")`;
  }
  const file = writeModFixture(flags.out, name);
  return `fixture: ${file} (textures/${name}.txt)`;
}
