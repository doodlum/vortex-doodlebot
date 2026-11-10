import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContent } from "./content";
import { find7Zip, getRelease, releaseCli, versionMatches, type ReleaseDeps } from "./releaseFetch";

const INSTALLER = Buffer.from("pretend NSIS installer bytes");
const DIGEST = `sha256:${createHash("sha256").update(INSTALLER).digest("hex")}`;
const API = "https://api.github.com/repos/Nexus-Mods/Vortex/releases/tags/v2.8.0";
const DOWNLOAD =
  "https://github.com/Nexus-Mods/Vortex/releases/download/v2.8.0/vortex-setup-2.8.0.exe";

let root: string;
let digest: string | null;
let downloads: number;
let execCalls: string[][];

function deps(overrides: Partial<ReleaseDeps> = {}): ReleaseDeps {
  return {
    releasesDir: path.join(root, "releases"),
    contentFile: path.join(root, "content.json"),
    now: () => new Date("2026-11-10T10:00:00.000Z"),
    write: () => undefined,
    find7z: () => "C:\\Program Files\\7-Zip\\7z.exe",
    productVersion: () => "2.8.0.0",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers["User-Agent"]).toBe("doodlebot");
      if (url === API)
        return Response.json({
          tag_name: "v2.8.0",
          prerelease: false,
          assets: [
            {
              name: "vortex-setup-2.8.0.exe",
              browser_download_url: DOWNLOAD,
              digest,
            },
          ],
        });
      if (url === DOWNLOAD) {
        downloads++;
        return new Response(INSTALLER);
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
    exec: async (_file, args) => {
      execCalls.push(args);
      const out = args.find((a) => a.startsWith("-o"))!.slice(2);
      fs.mkdirSync(out, { recursive: true });
      if (args[0] === "e") fs.writeFileSync(path.join(out, "app-64.7z"), "inner archive");
      if (args[0] === "x") fs.writeFileSync(path.join(out, "Vortex.exe"), "exe");
      return { code: 0, output: "Everything is Ok" };
    },
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "release-fetch-"));
  digest = DIGEST;
  downloads = 0;
  execCalls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("release get", () => {
  it("downloads, verifies, extracts without running the installer and registers", async () => {
    const release = await getRelease("2.8.0", deps());
    const dir = path.join(root, "releases", "2.8.0");
    expect(release).toEqual({
      version: "2.8.0",
      path: path.join(dir, "app"),
      exe: path.join(dir, "app", "Vortex.exe"),
      sha256: DIGEST.slice("sha256:".length),
      registeredAt: "2026-11-10T10:00:00.000Z",
    });
    expect(execCalls).toEqual([
      ["e", path.join(dir, "vortex-setup-2.8.0.exe"), "$PLUGINSDIR\\app-64.7z", `-o${dir}`, "-y"],
      ["x", path.join(dir, "app-64.7z"), `-o${path.join(dir, "app")}`, "-y"],
    ]);
    // The installer and the inner archive are gone; only the app is kept.
    expect(fs.readdirSync(dir)).toEqual(["app"]);
    expect(readContent(path.join(root, "content.json")).releases).toEqual([release]);
    expect(await releaseCli(["list"], {}, deps())).toContain("2.8.0");
    // A registered release is not fetched again.
    await getRelease("2.8.0", deps());
    expect(downloads).toBe(1);
  });

  it("refuses a download whose SHA-256 differs from the published digest", async () => {
    digest = `sha256:${"0".repeat(64)}`;
    await expect(getRelease("2.8.0", deps())).rejects.toThrow(
      /does not match the published 0{64}; it was deleted/,
    );
    expect(fs.existsSync(path.join(root, "releases", "2.8.0", "vortex-setup-2.8.0.exe"))).toBe(
      false,
    );
    expect(execCalls).toEqual([]);
    expect(readContent(path.join(root, "content.json")).releases).toEqual([]);
  });

  it("is blocked when the release publishes no digest", async () => {
    digest = null;
    await expect(getRelease("2.8.0", deps())).rejects.toThrow(
      "blocked: the release publishes no digest",
    );
    expect(downloads).toBe(0);
  });

  it("refuses without 7-Zip, naming how to install it", async () => {
    await expect(getRelease("2.8.0", deps({ find7z: () => undefined }))).rejects.toThrow(
      /7-Zip is needed .*winget install 7zip\.7zip/,
    );
    expect(downloads).toBe(0);
  });

  it("refuses an app whose version resource is another version", async () => {
    await expect(getRelease("2.8.0", deps({ productVersion: () => "2.7.1.0" }))).rejects.toThrow(
      /reports version 2.7.1.0, not 2.8.0; it was not registered/,
    );
    expect(readContent(path.join(root, "content.json")).releases).toEqual([]);
  });

  it("refuses an unknown release and a malformed version", async () => {
    await expect(getRelease("9.9.9", deps())).rejects.toThrow(
      "No release v9.9.9 on Nexus-Mods/Vortex.",
    );
    await expect(getRelease("../2.8.0", deps())).rejects.toThrow(/is not a Vortex version/);
  });
});

describe("release helpers", () => {
  it("matches a four-part version resource to a three-part version", () => {
    expect(versionMatches("2.8.0.0", "2.8.0")).toBe(true);
    expect(versionMatches("2.8.0", "2.8.0")).toBe(true);
    expect(versionMatches("2.8.10.0", "2.8.1")).toBe(false);
    expect(versionMatches(undefined, "2.8.0")).toBe(false);
  });

  it("finds 7-Zip on the PATH, then under Program Files", () => {
    const onPath = path.join("C:\\tools", "7z.exe");
    expect(find7Zip({ PATH: `C:\\nothing${path.delimiter}C:\\tools` }, (f) => f === onPath)).toBe(
      onPath,
    );
    const programFiles = path.join("C:\\Program Files", "7-Zip", "7z.exe");
    expect(
      find7Zip({ PATH: "", ProgramFiles: "C:\\Program Files" }, (f) => f === programFiles),
    ).toBe(programFiles);
    expect(find7Zip({ PATH: "" }, () => false)).toBeUndefined();
  });
});
