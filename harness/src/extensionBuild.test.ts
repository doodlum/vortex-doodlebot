import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildExtension,
  ExtensionBuildCancelledError,
  ExtensionBuildError,
} from "./extensionBuild";
import { verifyExtensionGeneration } from "./extensionGeneration";
import { processAlive } from "./processes";
import { runEvidenceProcess } from "./processRunner";

const pass: Awaited<ReturnType<typeof runEvidenceProcess>> = {
  code: 0,
  signal: null,
  output: "",
  stdout: "",
  aborted: false,
};
let source: string;
let signalListeners: number[];
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

beforeEach(() => {
  source = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot finite build "));
  fs.mkdirSync(path.join(source, "src"));
  fs.writeFileSync(path.join(source, "src", "index.ts"), "captured source");
  fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot"}');
  for (const file of ["tsup.config.ts", "tsconfig.json", "package.json", "pnpm-lock.yaml"])
    fs.writeFileSync(path.join(source, file), "{}");
  signalListeners = signals.map((signal) => process.listenerCount(signal));
});

afterEach(() => {
  expect(signals.map((signal) => process.listenerCount(signal))).toEqual(signalListeners);
  fs.rmSync(source, { recursive: true, force: true });
});

function output(root = source): void {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "index.js"), "synthetic output");
}

it("runs one finite compiler on a private stage and publishes a verified dist", async () => {
  const runner = vi.fn<typeof runEvidenceProcess>(async (options) => {
    expect(options.executable).toBe(process.execPath);
    expect(options.args).toHaveLength(1);
    expect(options.args[0]).toMatch(/tsup[/\\]dist[/\\]cli-default\.js$/);
    expect(path.dirname(options.cwd)).toBe(path.join(source, "harness", ".artifacts"));
    expect(fs.readFileSync(path.join(options.cwd, "src", "index.ts"), "utf8")).toBe(
      "captured source",
    );
    output(options.cwd);
    return pass;
  });
  await buildExtension({ source, runner });
  expect(runner).toHaveBeenCalledTimes(1);
  expect(fs.readFileSync(path.join(source, "dist", "index.js"), "utf8")).toBe("synthetic output");
  expect(() => verifyExtensionGeneration(path.join(source, "dist"))).not.toThrow();
  expect(
    fs
      .readdirSync(path.join(source, "harness", ".artifacts"))
      .filter((file) => file.startsWith("extension-build-")),
  ).toEqual([]);
});

it.each(["nonzero exit", "missing output", "cancelled zero exit"])(
  "rejects %s",
  async (failure) => {
    if (failure !== "missing output") output();
    const result = {
      ...pass,
      code: failure === "nonzero exit" ? 1 : 0,
      aborted: failure === "cancelled zero exit",
    };
    await expect(buildExtension({ source, runner: async () => result })).rejects.toBeInstanceOf(
      failure === "cancelled zero exit" ? ExtensionBuildCancelledError : ExtensionBuildError,
    );
  },
);

it("does not start a compiler when already cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const runner = vi.fn<typeof runEvidenceProcess>();
  await expect(
    buildExtension({ source, signal: controller.signal, runner }),
  ).rejects.toBeInstanceOf(ExtensionBuildCancelledError);
  expect(runner).not.toHaveBeenCalled();
});

it("awaits a real synthetic child's exit before rejecting a cancelled build", async () => {
  const controller = new AbortController();
  let pid = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pending = buildExtension({
    source,
    signal: controller.signal,
    runner: (options) =>
      runEvidenceProcess({
        ...options,
        // Exercise the real process lifecycle without invoking the extension compiler or Vortex.
        args: ["-e", "process.stdout.write(String(process.pid)+'\\n');setInterval(()=>{},1000)"],
        onOutput: (chunk) => {
          pid = Number(chunk.toString().trim());
          markStarted();
        },
      }),
  });
  void pending.catch(() => undefined);
  try {
    await Promise.race([started, pending]);
    expect(pid).toBeGreaterThan(0);
    expect(processAlive(pid)).toBe(true);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ExtensionBuildCancelledError);
    expect(processAlive(pid)).toBe(false);
  } finally {
    controller.abort();
    await pending.catch(() => undefined);
  }
});
