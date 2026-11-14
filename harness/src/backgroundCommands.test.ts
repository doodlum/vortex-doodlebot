import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot background "));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

it.skipIf(process.platform !== "win32").each(["try", "setup"])(
  "%s's documented Windows background template preserves the Node route and arguments",
  (skill) => {
    const text = fs
      .readFileSync(path.join(REPO_ROOT, `plugins/doodlebot/skills/${skill}/SKILL.md`), "utf8")
      .replace(/\r\n/g, "\n");
    const template = /```powershell\n([\s\S]*?)\n\s*```/
      .exec(text)?.[1]
      ?.split("\n")
      .map((line) => line.trimStart())
      .join("\n");
    expect(template).toBeDefined();
    expect(template).toContain("-WindowStyle Hidden");
    const entry = path.join(temp, "fake entry.cjs");
    fs.writeFileSync(entry, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
    const log = path.join(temp, "run.log");
    const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
    const checkout = path.join(temp, "source checkout");
    const command =
      template!
        .replace(/^\$log = .*$/m, `$log = ${quote(log)}`)
        .replaceAll("<shim>", quote(process.execPath))
        .replaceAll("<prefix-args>", `@('"${entry}"')`)
        .replaceAll("<args>", `@('up','--dev-dir','"${checkout}"')`) + "\n$p.WaitForExit()";
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(log, "utf8"))).toEqual(
      skill === "setup"
        ? ["setup", "--oauth", "--installed", "--no-wait"]
        : ["up", "--dev-dir", checkout],
    );
    expect(fs.readFileSync(`${log}.err`, "utf8")).toBe("");
  },
  20_000,
);
