import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildExtension, ExtensionBuildCancelledError } from "./extensionBuild";
import {
  captureExtensionInputs,
  extensionIsFresh,
  ExtensionInputsChangedError,
  verifyExtensionGeneration,
} from "./extensionGeneration";
import { ensureExtensionBuilt, installMcpExtension } from "./instance";
import type { runEvidenceProcess } from "./processRunner";

const pass: Awaited<ReturnType<typeof runEvidenceProcess>> = {
  code: 0,
  signal: null,
  output: "",
  stdout: "",
  aborted: false,
};
let root: string;
let source: string;
let profile: string;
let leaseEnv: { dir: string };
let runner: ReturnType<typeof vi.fn<typeof runEvidenceProcess>>;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot generation "));
  source = path.join(root, "source");
  profile = path.join(root, "profile");
  leaseEnv = { dir: path.join(root, "leases") };
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "src", "index.ts"), "initial");
  fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot","version":"1"}');
  for (const file of ["package.json", "tsconfig.json", "tsup.config.ts", "pnpm-lock.yaml"])
    fs.writeFileSync(path.join(source, file), "{}");
  runner = vi.fn<typeof runEvidenceProcess>(async ({ cwd }) => {
    output(cwd, fs.readFileSync(path.join(cwd, "src", "index.ts"), "utf8"));
    return pass;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const options = () => ({ source, owner: "builder", leaseEnv, runner });
const dist = () => path.join(source, "dist");
const plugin = () => path.join(profile, "userData", "plugins", "doodlebot");
const bundle = (dir = dist()) => fs.readFileSync(path.join(dir, "index.js"), "utf8");
const edit = (text: string) => fs.writeFileSync(path.join(source, "src", "index.ts"), text);
function output(stage: string, text: string): void {
  fs.mkdirSync(path.join(stage, "dist"), { recursive: true });
  fs.writeFileSync(path.join(stage, "dist", "index.js"), text);
}
function install(): void {
  installMcpExtension(profile, source, options());
}

it("a failed compiler preserves its previous generation and ordinary ensure/install rebuild changed inputs", async () => {
  await buildExtension(options());
  const previous = verifyExtensionGeneration(dist());
  edit("corrected source");
  runner.mockImplementationOnce(async ({ cwd }) => {
    output(cwd, "partial failed output");
    return { ...pass, code: 1 };
  });
  await expect(buildExtension(options())).rejects.toThrow(/exited 1/);
  expect(bundle()).toBe("initial");
  expect(verifyExtensionGeneration(dist())).toEqual(previous);
  expect(extensionIsFresh(source)).toBe(false);
  expect(install).toThrow(/fresh generation/);
  await ensureExtensionBuilt(options());
  install();
  expect(bundle(plugin())).toBe("corrected source");
  expect(runner).toHaveBeenCalledTimes(3);
  await ensureExtensionBuilt(options());
  expect(runner).toHaveBeenCalledTimes(3);
});

it("captured compiler and metadata inputs stay unchanged through an edit and Undo", async () => {
  const original = captureExtensionInputs(source).digest;
  runner.mockImplementationOnce(async ({ cwd }) => {
    edit("transient source");
    fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot","version":"transient"}');
    output(cwd, fs.readFileSync(path.join(cwd, "src", "index.ts"), "utf8"));
    expect(JSON.parse(fs.readFileSync(path.join(cwd, "info.json"), "utf8")).version).toBe("1");
    edit("initial");
    fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot","version":"1"}');
    return pass;
  });
  await buildExtension(options());
  expect(verifyExtensionGeneration(dist()).inputDigest).toBe(original);
  install();
  expect(bundle(plugin())).toBe("initial");
  expect(JSON.parse(fs.readFileSync(path.join(plugin(), "info.json"), "utf8")).version).toBe("1");
});

it("refuses lasting input drift before publication and retains the last successful output", async () => {
  await buildExtension(options());
  runner.mockImplementationOnce(async ({ cwd }) => {
    output(cwd, "obsolete");
    edit("latest");
    return pass;
  });
  await expect(buildExtension(options())).rejects.toBeInstanceOf(ExtensionInputsChangedError);
  expect(bundle()).toBe("initial");
  expect(extensionIsFresh(source)).toBe(false);
  await ensureExtensionBuilt(options());
  expect(bundle()).toBe("latest");
});

it("cancellation cannot replace a successful output with partial staged files", async () => {
  await buildExtension(options());
  const previous = verifyExtensionGeneration(dist());
  runner.mockImplementationOnce(async ({ cwd }) => {
    output(cwd, "partial cancelled output");
    return { ...pass, aborted: true };
  });
  await expect(buildExtension(options())).rejects.toBeInstanceOf(ExtensionBuildCancelledError);
  expect(bundle()).toBe("initial");
  expect(verifyExtensionGeneration(dist())).toEqual(previous);
  expect(extensionIsFresh(source)).toBe(true);
});

it("freshness covers config, lock, metadata, additions and deletions rather than timestamps", async () => {
  await ensureExtensionBuilt(options());
  for (const file of [
    "package.json",
    "tsconfig.json",
    "tsup.config.ts",
    "pnpm-lock.yaml",
    "info.json",
    "src/added.ts",
  ]) {
    const target = path.join(source, file);
    fs.writeFileSync(target, file === "info.json" ? '{"id":"doodlebot","version":"2"}' : "changed");
    fs.utimesSync(target, new Date(0), new Date(0));
    expect(extensionIsFresh(source), file).toBe(false);
    await ensureExtensionBuilt(options());
    expect(extensionIsFresh(source)).toBe(true);
  }
  fs.unlinkSync(path.join(source, "src", "added.ts"));
  expect(extensionIsFresh(source)).toBe(false);
  await ensureExtensionBuilt(options());
  expect(runner).toHaveBeenCalledTimes(8);
});

it("rejects tampered output even when its success marker and mtime are present", async () => {
  await buildExtension(options());
  fs.writeFileSync(path.join(dist(), "index.js"), "unverified external output");
  expect(extensionIsFresh(source)).toBe(false);
  expect(install).toThrow(/No verified extension generation/);
  expect(fs.existsSync(profile)).toBe(false);
});

it("missing configuration cannot fall back to a mutable ancestor outside the captured stage", async () => {
  await buildExtension(options());
  fs.unlinkSync(path.join(source, "tsup.config.ts"));
  expect(extensionIsFresh(source)).toBe(false);
  await expect(ensureExtensionBuilt(options())).rejects.toThrow(
    /Missing captured build input tsup.config.ts/,
  );
  expect(runner).toHaveBeenCalledTimes(1);
  expect(bundle()).toBe("initial");
});

it("a build promotion rename failure restores the previous dist", async () => {
  await buildExtension(options());
  const previous = verifyExtensionGeneration(dist());
  edit("replacement");
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(from).includes("extension-build-") && path.resolve(String(to)) === dist())
      throw new Error("injected promotion failure");
    rename(from, to);
  });
  await expect(buildExtension(options())).rejects.toThrow(/injected promotion failure/);
  expect(bundle()).toBe("initial");
  expect(verifyExtensionGeneration(dist())).toEqual(previous);
  expect(extensionIsFresh(source)).toBe(false);
});

it.each(["copy", "rename"])(
  "a profile %s failure leaves the previously installed plugin intact",
  async (failure) => {
    await buildExtension(options());
    install();
    const previous = verifyExtensionGeneration(plugin());
    edit("replacement");
    await buildExtension(options());
    if (failure === "copy") {
      vi.spyOn(fs, "cpSync").mockImplementation((_from, to) => {
        fs.mkdirSync(to, { recursive: true });
        fs.writeFileSync(path.join(String(to), "index.js"), "partial copy");
        throw new Error("injected copy failure");
      });
    } else {
      const rename = fs.renameSync;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (String(from).includes(".doodlebot-install-") && path.resolve(String(to)) === plugin())
          throw new Error("injected rename failure");
        rename(from, to);
      });
    }
    expect(install).toThrow(/injected/);
    expect(bundle(plugin())).toBe("initial");
    expect(verifyExtensionGeneration(plugin())).toEqual(previous);
  },
);

it.each(["build", "profile"])(
  "a failed %s rollback preserves the named recovery backup",
  async (kind) => {
    await buildExtension(options());
    if (kind === "profile") install();
    edit("replacement");
    if (kind === "profile") await buildExtension(options());
    const target = kind === "build" ? dist() : plugin();
    const recovery = kind === "build" ? path.join(source, "harness", ".artifacts") : profile;
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (path.resolve(String(to)) === target)
        throw new Error("injected rename and rollback failure");
      rename(from, to);
    });
    if (kind === "build")
      await expect(buildExtension(options())).rejects.toThrow(/Previous generation retained at/);
    else expect(install).toThrow(/Previous generation retained at/);
    const backups = fs.readdirSync(recovery).filter((file) => file.includes("-backup-"));
    expect(backups).toHaveLength(1);
    expect(bundle(path.join(recovery, backups[0]!))).toBe("initial");
    expect(() => verifyExtensionGeneration(path.join(recovery, backups[0]!))).not.toThrow();
    expect(fs.existsSync(target)).toBe(false);
  },
);
