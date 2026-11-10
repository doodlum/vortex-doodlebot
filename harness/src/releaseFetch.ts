/**
 * Official Vortex releases without their installer. `doodlebot release get <version>` downloads
 * `vortex-setup-<version>.exe` from github.com/Nexus-Mods/Vortex/releases (pre-releases count),
 * checks it against the SHA-256 digest GitHub publishes for the asset, and extracts the app with
 * 7-Zip: the installer, then its inner `app-64.7z`. The installer never runs, so the owner's own
 * installation is never found, replaced or uninstalled.
 *
 * Releases live in `~/.doodlebot/releases/<version>/app`, outside every workspace: under the
 * repository Node takes the workspace's package.json as the app's package scope and the renderer
 * fails with `Cannot find module './common'` (KNOWLEDGE.md). Each is registered in content.json,
 * and `--release <version>` selects it (config.ts).
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { ConfigError } from "./errors";
import { findRelease, readContent, registerRelease, type RegisteredRelease } from "./content";
import { CONTENT_FILE, RELEASES_DIR } from "./paths";

export const RELEASE_REPO = "Nexus-Mods/Vortex";
export const SEVEN_ZIP_HINT =
  "Install 7-Zip (`winget install 7zip.7zip`, or https://www.7-zip.org), then retry.";

export interface ExecResult {
  code: number;
  output: string;
}

export interface ReleaseDeps {
  fetch?: typeof fetch;
  exec?: (file: string, args: string[]) => Promise<ExecResult>;
  find7z?: () => string | undefined;
  /** Vortex.exe's version resource (`ProductVersion`). */
  productVersion?: (exe: string) => string | undefined;
  releasesDir?: string;
  contentFile?: string;
  now?: () => Date;
  write?: (message: string) => void;
}

/** 7-Zip on the PATH, or under Program Files. */
export function find7Zip(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = fs.existsSync,
): string | undefined {
  const names = process.platform === "win32" ? ["7z.exe"] : ["7z", "7zz"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean))
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  for (const root of [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"]]) {
    if (root === undefined) continue;
    const candidate = path.join(root, "7-Zip", "7z.exe");
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** `2.8.0.0` and `2.8.0` match `2.8.0`; `2.8.10` does not. */
export function versionMatches(productVersion: string | undefined, version: string): boolean {
  if (productVersion === undefined) return false;
  const actual = productVersion.trim();
  if (!actual.startsWith(version)) return false;
  const rest = actual.slice(version.length);
  return rest === "" || /^[.+-]/.test(rest);
}

/** A file's ProductVersion, through PowerShell. */
export function windowsProductVersion(file: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const value = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Item -LiteralPath '${file.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
      ],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

function runProcess(file: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer): void => {
      output = (output + chunk.toString("utf8")).slice(-8_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  digest?: string | null;
}

async function readReleaseAsset(version: string, fetcher: typeof fetch): Promise<GitHubAsset> {
  const url = `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/v${version}`;
  const response = await fetcher(url, {
    headers: { "User-Agent": "doodlebot", Accept: "application/vnd.github+json" },
  });
  if (response.status === 404) throw new ConfigError(`No release v${version} on ${RELEASE_REPO}.`);
  if (!response.ok)
    throw new ConfigError(`GitHub answered ${String(response.status)} for ${url}; retry later.`);
  const release = (await response.json()) as { assets?: GitHubAsset[] };
  const name = `vortex-setup-${version}.exe`;
  const asset = release.assets?.find((a) => a.name === name);
  if (asset === undefined) throw new ConfigError(`Release v${version} has no ${name}.`);
  return asset;
}

/** Download to `file`, returning the SHA-256 of what was written. */
async function download(url: string, file: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, { headers: { "User-Agent": "doodlebot" } });
  if (!response.ok || response.body === null)
    throw new ConfigError(`Downloading ${url} failed with ${String(response.status)}.`);
  const hash = createHash("sha256");
  const out = fs.createWriteStream(file);
  try {
    for await (const chunk of Readable.fromWeb(response.body as never) as AsyncIterable<Buffer>) {
      hash.update(chunk);
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  }
  return hash.digest("hex");
}

/** `release get <version>`: download, verify, extract, check and register. */
export async function getRelease(
  version: string,
  deps: ReleaseDeps = {},
): Promise<RegisteredRelease> {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new ConfigError(`${version} is not a Vortex version (for example 2.8.0).`);
  const write = deps.write ?? ((message: string) => process.stdout.write(`${message}\n`));
  const contentFile = deps.contentFile ?? CONTENT_FILE;
  const existing = findRelease(version, contentFile);
  if (existing !== undefined && fs.existsSync(existing.exe)) {
    write(`Release ${version} is already registered at ${existing.path}.`);
    return existing;
  }

  const fetcher = deps.fetch ?? fetch;
  const asset = await readReleaseAsset(version, fetcher);
  const expected = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1]?.toLowerCase();
  if (expected === undefined) throw new ConfigError("blocked: the release publishes no digest");
  const sevenZip = (deps.find7z ?? find7Zip)();
  if (sevenZip === undefined)
    throw new ConfigError(
      `7-Zip is needed to extract the release without running its installer. ${SEVEN_ZIP_HINT}`,
    );

  const dir = path.join(deps.releasesDir ?? RELEASES_DIR, version);
  fs.mkdirSync(dir, { recursive: true });
  const installer = path.join(dir, asset.name);
  write(`Downloading ${asset.name}`);
  const actual = await download(asset.browser_download_url, installer, fetcher);
  if (actual !== expected) {
    fs.rmSync(installer, { force: true });
    throw new ConfigError(
      `The download's SHA-256 ${actual} does not match the published ${expected}; it was deleted.`,
    );
  }

  const exec = deps.exec ?? runProcess;
  const inner = path.join(dir, "app-64.7z");
  const appDir = path.join(dir, "app");
  fs.rmSync(inner, { force: true });
  fs.rmSync(appDir, { recursive: true, force: true });
  write("Extracting the app with 7-Zip (the installer is not run)");
  const first = await exec(sevenZip, ["e", installer, "$PLUGINSDIR\\app-64.7z", `-o${dir}`, "-y"]);
  if (first.code !== 0 || !fs.existsSync(inner))
    throw new ConfigError(
      `7-Zip could not take app-64.7z out of ${installer} (exit ${String(first.code)}):\n${first.output}`,
    );
  const second = await exec(sevenZip, ["x", inner, `-o${appDir}`, "-y"]);
  if (second.code !== 0)
    throw new ConfigError(
      `7-Zip could not extract ${inner} (exit ${String(second.code)}):\n${second.output}`,
    );
  const exe = path.join(appDir, "Vortex.exe");
  if (!fs.existsSync(exe))
    throw new ConfigError(`The extracted app has no Vortex.exe (${appDir}).`);
  fs.rmSync(inner, { force: true });
  fs.rmSync(installer, { force: true });

  const productVersion = (deps.productVersion ?? windowsProductVersion)(exe);
  if (!versionMatches(productVersion, version))
    throw new ConfigError(
      `${exe} reports version ${productVersion ?? "(none)"}, not ${version}; it was not registered.`,
    );
  const release: RegisteredRelease = {
    version,
    path: appDir,
    exe,
    sha256: actual,
    registeredAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  registerRelease(release, contentFile);
  return release;
}

/** The `release` command: `get <version>` and `list [--json]`. */
export async function releaseCli(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: ReleaseDeps = {},
): Promise<string> {
  const [sub, version] = positional;
  if (sub === "get") {
    if (version === undefined) throw new ConfigError("release get needs a version, e.g. 2.8.0.");
    const release = await getRelease(version, deps);
    return `Release ${release.version} is ready: ${release.exe}\nUse it with --release ${release.version}.`;
  }
  if (sub === "list") {
    const releases = readContent(deps.contentFile ?? CONTENT_FILE).releases;
    if (flags.json === true) return JSON.stringify(releases, null, 2);
    if (releases.length === 0)
      return "No releases registered. Get one with `doodlebot release get <version>`.";
    return releases
      .map((r) => `${r.version.padEnd(14)} ${r.exe} (registered ${r.registeredAt})`)
      .join("\n");
  }
  throw new ConfigError("Use release get <version> or release list [--json].");
}
