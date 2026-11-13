import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./paths";

const SCRIPT = path.join(REPO_ROOT, "plugins/doodlebot/scripts/command-probe.cjs");
interface ProbeResult {
  status: "found" | "missing" | "inaccessible" | "error";
  shim?: string;
  workspace?: string;
  diagnostics: { path: string; status: string; code: string }[];
}
const { probe } = createRequire(import.meta.url)(SCRIPT) as {
  probe: (options: {
    platform?: string;
    cwd?: string;
    env?: Record<string, string>;
    home?: string;
    shim?: string;
    inspect?: (file: string, platform: string) => boolean;
  }) => ProbeResult;
};

let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-command-probe-"));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

const error = (code: string) => Object.assign(new Error(code), { code });
const windows = (inspect: (file: string) => boolean) => ({
  platform: "win32",
  home: "",
  env: { Path: '"C:\\Program Files\\nodejs";C:\\tools' },
  inspect,
});
const blockedShim = "C:\\Program Files\\nodejs\\doodlebot.cmd";

describe("command discovery without the runtime", () => {
  it.each([
    {
      platform: "win32",
      cwd: "C:\\repo",
      pathValue: ".\\tools",
      expected: "C:\\repo\\tools\\doodlebot.cmd",
    },
    { platform: "linux", cwd: "/work", pathValue: "./tools", expected: "/work/tools/doodlebot" },
  ])(
    "returns an absolute route for relative PATH on $platform",
    ({ platform, cwd, pathValue, expected }) => {
      const result = probe({
        platform,
        cwd,
        home: "",
        env: { PATH: pathValue },
        inspect: () => true,
      });
      expect(result.shim).toBe(expected);
    },
  );

  it.each([":/usr/bin", "/usr/bin:", "/usr/bin::/opt/bin", ""])(
    "preserves current-directory POSIX PATH components: %s",
    (pathValue) => {
      const result = probe({
        platform: "linux",
        cwd: "/work",
        home: "",
        env: { PATH: pathValue },
        inspect: (file) => file === "/work/doodlebot",
      });
      expect(result.shim).toBe("/work/doodlebot");
    },
  );

  it.each(["/opt/kit bin ", '/opt/"kit"'])(
    "preserves literal POSIX PATH characters: %s",
    (directory) => {
      const result = probe({
        platform: "linux",
        cwd: "/work",
        home: "",
        env: { PATH: directory },
        inspect: (file) => file === directory + "/doodlebot",
      });
      expect(result.shim).toBe(directory + "/doodlebot");
    },
  );

  it.each(["EACCES", "EPERM"])(
    "keeps %s distinct from missing when PATH lookup hides the shim",
    (code) => {
      const result = probe(
        windows((file) => {
          if (file === blockedShim) throw error(code);
          throw error("ENOENT");
        }),
      );
      expect(result.status).toBe("inaccessible");
      expect(result.shim).toBeUndefined();
      expect(result.diagnostics).toEqual([{ path: blockedShim, status: "inaccessible", code }]);
    },
  );

  it("does not turn an unexpected filesystem failure into missing", () => {
    const result = probe(
      windows(() => {
        throw error("EIO");
      }),
    );
    expect(result.status).toBe("error");
    expect(result.diagnostics.every((item) => item.code === "EIO")).toBe(true);
  });

  it("reports missing only when the checked candidates are absent", () => {
    expect(
      probe(
        windows(() => {
          throw error("ENOENT");
        }),
      ),
    ).toEqual({
      status: "missing",
      diagnostics: [],
    });
  });

  it("can find a readable alternative while retaining an earlier access failure", () => {
    const result = probe(
      windows((file) => {
        if (file === blockedShim) throw error("EACCES");
        return true;
      }),
    );
    expect(result.status).toBe("found");
    expect(result.shim).toBe("C:\\tools\\doodlebot.cmd");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses POSIX PATH semantics and checks the extensionless command", () => {
    const seen: string[] = [];
    const result = probe({
      platform: "linux",
      home: "",
      env: { PATH: "/home/me/bin:/usr/bin" },
      inspect: (file) => {
        seen.push(file);
        return file === "/home/me/bin/doodlebot";
      },
    });
    expect(result.shim).toBe("/home/me/bin/doodlebot");
    expect(seen).toEqual(["/home/me/bin/doodlebot", "/usr/bin/doodlebot"]);
  });

  it("checks an explicitly known shim even when it is outside PATH", () => {
    const file = path.join(temp, "doodlebot.cmd");
    fs.writeFileSync(file, "@echo not executed");
    fs.chmodSync(file, 0o755);
    expect(probe({ home: "", env: {}, platform: process.platform, shim: file })).toMatchObject({
      status: "found",
      shim: file,
    });
  });

  it("recovers a recorded shim in a fresh process without launching it", () => {
    const home = path.join(temp, "home");
    const shim = path.join(temp, "doodlebot.cmd");
    const witness = path.join(temp, "launched");
    fs.mkdirSync(path.join(home, ".doodlebot"), { recursive: true });
    fs.writeFileSync(shim, `@echo launched>"${witness}"\n`);
    fs.chmodSync(shim, 0o755);
    fs.writeFileSync(
      path.join(home, ".doodlebot/workspace.json"),
      JSON.stringify({
        workspace: temp,
        shim,
      }),
    );
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: "", HOME: home, USERPROFILE: home },
      timeout: 5000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "found", workspace: temp, shim });
    expect(fs.existsSync(witness)).toBe(false);
    expect(fs.readdirSync(path.join(home, ".doodlebot"))).toEqual(["workspace.json"]);
  });

  it("keeps a legacy workspace record as a recovery hint when no shim is found", () => {
    fs.mkdirSync(path.join(temp, ".doodlebot"));
    fs.writeFileSync(
      path.join(temp, ".doodlebot/workspace.json"),
      JSON.stringify({ workspace: temp }),
    );
    expect(probe({ home: temp, env: {} })).toEqual({
      status: "missing",
      workspace: temp,
      diagnostics: [],
    });
  });

  it.each(["{broken", "null", '{"workspace":12}'])(
    "reports an unusable workspace record: %s",
    (value) => {
      fs.mkdirSync(path.join(temp, ".doodlebot"));
      fs.writeFileSync(path.join(temp, ".doodlebot/workspace.json"), value);
      expect(probe({ home: temp, env: {} }).status).toBe("error");
    },
  );
});
