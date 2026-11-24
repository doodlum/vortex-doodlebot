import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HarnessConfig } from "./config";
import {
  localOnlyConfig,
  removeCopyDeployments,
  removeRootDeployments,
  resetDisposableGameData,
} from "./sandbox";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function game(cacheDir: string, inside = true) {
  const gamePath = inside
    ? path.join(cacheDir, "sandbox", "game")
    : fs.mkdtempSync(path.join(os.tmpdir(), "outside-game-"));
  if (!inside) dirs.push(gamePath);
  const data = path.join(gamePath, "Data");
  fs.mkdirSync(path.join(data, "textures"), { recursive: true });
  fs.writeFileSync(path.join(data, "Fallout4.esm"), "master");
  fs.writeFileSync(path.join(data, "vortex.deployment.json"), "{}");
  fs.writeFileSync(path.join(data, "textures", "x.dds"), "x");
  return { config: { cacheDir, gamePath } as HarnessConfig, data };
}

describe("resetDisposableGameData", () => {
  it("empties Data, keeping the fixture's own files", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "reset-game-"));
    dirs.push(cache);
    const { config, data } = game(cache);

    expect(resetDisposableGameData(config, { keep: ["fallout4.esm"] })).toBe(true);
    expect(fs.readdirSync(data)).toEqual(["Fallout4.esm"]);
  });

  it("never touches a game outside the harness cache", () => {
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "reset-game-"));
    dirs.push(cache);
    const { config, data } = game(cache, false);
    expect(resetDisposableGameData(config)).toBe(false);
    expect(fs.readdirSync(data).sort()).toEqual(
      ["Fallout4.esm", "textures", "vortex.deployment.json"].sort(),
    );
  });
});

describe("local-only sandbox runs", () => {
  const base = { apiKey: "key-from-env", cacheDir: "c" } as HarnessConfig;

  it("leave the configured API key out, and say so", () => {
    expect(localOnlyConfig(base, false)).toMatchObject({ apiKey: undefined, apiKeyWithheld: true });
    expect(base.apiKey).toBe("key-from-env");
  });

  it("keep it when asked, and change nothing without one", () => {
    expect(localOnlyConfig(base, true)).toBe(base);
    const none = { ...base, apiKey: undefined };
    expect(localOnlyConfig(none, false)).toBe(none);
  });
});

describe("removeRootDeployments", () => {
  it("removes what an engine-injector deployment put beside Data, and nothing else", () => {
    const game = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-rootdeploy-"));
    dirs.push(game);
    for (const name of ["Fallout4.exe", "f4se_loader.exe", "f4se_1_10_163.dll"])
      fs.writeFileSync(path.join(game, name), "x");
    fs.mkdirSync(path.join(game, "Data"));
    fs.writeFileSync(path.join(game, "Data", "keep.esp"), "x");
    fs.writeFileSync(
      path.join(game, "vortex.deployment.dinput.json"),
      JSON.stringify({
        targetPath: game,
        files: [
          { relPath: "f4se_loader.exe" },
          { relPath: "f4se_1_10_163.dll" },
          { relPath: "Data/keep.esp" },
          { relPath: "../outside.txt" },
        ],
      }),
    );
    fs.writeFileSync(path.join(path.dirname(game), "outside.txt"), "x");
    dirs.push(path.join(path.dirname(game), "outside.txt"));

    expect(removeRootDeployments(game).sort()).toEqual(
      ["f4se_1_10_163.dll", "f4se_loader.exe", "vortex.deployment.dinput.json"].sort(),
    );
    expect(fs.readdirSync(game).sort()).toEqual(["Data", "Fallout4.exe"]);
    // Data is the caller's to clear, and nothing outside the game folder is touched
    expect(fs.existsSync(path.join(game, "Data", "keep.esp"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(game), "outside.txt"))).toBe(true);
  });
});

describe("removeCopyDeployments", () => {
  it("undoes an earlier deployment in a game copy, keeping the game's own files", () => {
    const game = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-copydeploy-"));
    dirs.push(game);
    const data = path.join(game, "Data");
    fs.mkdirSync(path.join(data, "meshes"), { recursive: true });
    fs.writeFileSync(path.join(game, "SkyrimSE.exe"), "game");
    fs.writeFileSync(path.join(data, "Skyrim.esm"), "master");
    fs.writeFileSync(path.join(data, "Untracked.esp"), "placed by hand");
    // Deployed by the earlier profile: two plugins, and a game file Vortex moved aside.
    fs.writeFileSync(path.join(data, "ProbeAlpha.esp"), "mod");
    fs.writeFileSync(path.join(data, "meshes", "x.nif"), "mod mesh");
    fs.writeFileSync(path.join(data, "meshes", "x.nif.vortex_backup"), "game mesh");
    fs.writeFileSync(
      path.join(data, "vortex.deployment.json"),
      JSON.stringify({
        instance: "earlier-profile",
        targetPath: data,
        files: [
          { relPath: "ProbeAlpha.esp" },
          { relPath: "meshes/x.nif" },
          { relPath: "../../outside.txt" },
        ],
      }),
    );
    fs.writeFileSync(path.join(path.dirname(game), "outside.txt"), "x");
    dirs.push(path.join(path.dirname(game), "outside.txt"));

    expect(removeCopyDeployments(game).sort()).toEqual(
      [
        path.join("Data", "ProbeAlpha.esp"),
        path.join("Data", "meshes", "x.nif"),
        path.join("Data", "vortex.deployment.json"),
      ].sort(),
    );
    expect(fs.readdirSync(data).sort()).toEqual(["Skyrim.esm", "Untracked.esp", "meshes"].sort());
    expect(fs.readFileSync(path.join(data, "meshes", "x.nif"), "utf8")).toBe("game mesh");
    expect(fs.existsSync(path.join(data, "meshes", "x.nif.vortex_backup"))).toBe(false);
    expect(fs.existsSync(path.join(game, "SkyrimSE.exe"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(game), "outside.txt"))).toBe(true);
  });

  it("removes an unreadable manifest and finds nothing in a copy never deployed to", () => {
    const game = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-copydeploy-"));
    dirs.push(game);
    fs.mkdirSync(path.join(game, "Data"));
    expect(removeCopyDeployments(game)).toEqual([]);
    fs.writeFileSync(path.join(game, "Data", "vortex.deployment.json"), "{not json");
    expect(removeCopyDeployments(game)).toEqual([path.join("Data", "vortex.deployment.json")]);
    expect(fs.readdirSync(path.join(game, "Data"))).toEqual([]);
  });
});
