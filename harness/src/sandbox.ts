import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "./config";

/** A disposable install for UI, local archive, deploy and purge tests. Cannot run the game. */
export function sandboxConfig(config: HarnessConfig): HarnessConfig {
  const gamePath = path.join(config.cacheDir, "sandbox", "game");
  fs.mkdirSync(path.join(gamePath, "Data"), { recursive: true });
  const executable = path.join(gamePath, "game.exe");
  if (!fs.existsSync(executable))
    fs.writeFileSync(executable, "Vortex automation fixture; not executable.\n");
  return { ...config, gameId: "vortexaisandbox", gamePath };
}

/**
 * A sandbox run is local-only: leave harness/.env's API key out unless asked for.
 *
 * With a key seeded, Vortex looks every locally installed archive up on Nexus. For the
 * sandbox's archives that lookup finds nothing and only ends at its 60 s timeout, so each
 * install looks hung. The key also changes the snapshot, so a run with and one without it
 * keep separate baselines; pass the same choice to every command.
 */
export function localOnlyConfig(config: HarnessConfig, keepApiKey: boolean): HarnessConfig {
  if (keepApiKey || config.apiKey === undefined || config.apiKey.trim() === "") return config;
  return { ...config, apiKey: undefined, apiKeyWithheld: true };
}

/**
 * Empty a disposable game's deployed files when its working profile is reset.
 *
 * A fresh profile knows about no deployment, but the game directory kept the last run's
 * files and manifest. Vortex then reports them as changed outside it (sources deleted)
 * and blocks the next deploy on that dialog, and purges leave them behind. Only a game
 * directory inside the harness cache is ever touched; `keep` names files the fixture
 * itself provides, such as a Bethesda game's own master.
 */
export function resetDisposableGameData(
  config: HarnessConfig,
  options: { keep?: string[] } = {},
): boolean {
  if (config.gamePath === undefined) return false;
  const relative = path.relative(path.resolve(config.cacheDir), path.resolve(config.gamePath));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  removeRootDeployments(config.gamePath);
  const data = path.join(config.gamePath, "Data");
  if (!fs.existsSync(data)) return false;
  const keep = new Set((options.keep ?? []).map((name) => name.toLowerCase()));
  for (const entry of fs.readdirSync(data)) {
    if (keep.has(entry.toLowerCase())) continue;
    fs.rmSync(path.join(data, entry), { recursive: true, force: true });
  }
  return true;
}

/**
 * Mod types that deploy into the game's root rather than Data (the Bethesda "Engine injector",
 * `dinput`, for a script extender) keep their own manifest there, `vortex.deployment.<type>.json`.
 * Clearing Data alone left their files behind, so the next fresh profile discovered the script
 * extender at activation and a "found after activation" bug looked fixed. Remove every file those
 * manifests list, and the manifests, as long as it lies inside the game folder.
 */
export function removeRootDeployments(gamePath: string): string[] {
  const root = path.resolve(gamePath);
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return removed;
  }
  for (const name of names.filter((n) => /^vortex\.deployment(\..+)?\.json$/i.test(n))) {
    const manifestPath = path.join(root, name);
    let manifest: { targetPath?: string; files?: Array<{ relPath?: string }> } = {};
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as typeof manifest;
    } catch {
      // unreadable: still remove it below, it describes nothing we can trust
    }
    const target = path.resolve(manifest.targetPath ?? root);
    for (const file of manifest.files ?? []) {
      if (typeof file.relPath !== "string") continue;
      const abs = path.resolve(target, file.relPath);
      const relative = path.relative(root, abs);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      // Data is emptied wholesale by the caller; this is for what sits beside it
      if (relative.toLowerCase().split(path.sep)[0] === "data") continue;
      fs.rmSync(abs, { force: true });
      removed.push(relative);
    }
    fs.rmSync(manifestPath, { force: true });
    removed.push(name);
  }
  return removed;
}

/** A real game-support extension, without game-specific writes to Documents or AppData. */
export function installSandboxExtension(instanceDir: string, config: HarnessConfig): void {
  if (config.gameId !== "vortexaisandbox") return;
  const dir = path.join(instanceDir, "userData", "plugins", "game-vortex-ai-sandbox");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "info.json"),
    JSON.stringify({
      id: "game-vortex-ai-sandbox",
      name: "Vortex Automation Sandbox",
      author: "vortex-mcp",
      version: "1.0.0",
      description: "Disposable game for automation tests",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ type: "commonjs", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(dir, "index.js"),
    `module.exports.default = function(context) {
    context.registerGame({ id: "vortexaisandbox", name: "Vortex Automation Sandbox",
      queryPath: () => Promise.resolve(${JSON.stringify(config.gamePath)}),
      queryModPath: () => "Data", executable: () => "game.exe", requiredFiles: ["game.exe"],
      supportedTools: [], environment: {}, mergeMods: true });
    return true;
  };\n`,
  );
}
