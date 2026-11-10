#!/usr/bin/env node
// The `doodlebot` command. It finds its workspace from its own location and runs the harness CLI
// there with the workspace's tsx, from any directory: the CLI's cwd is the workspace root and
// INIT_CWD is the caller's directory, against which the CLI resolves the paths the caller typed.
// `update` is handled here in plain Node, before tsx loads, because it replaces that code.
"use strict";
const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const command = args[0];

if (command === "update") {
  const { update, parseUpdateArgs } = require("./update.cjs");
  try {
    update(root, parseUpdateArgs(args.slice(1)));
  } catch (error) {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n\n`);
    process.exitCode = 1;
  }
} else {
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(root, "harness", "src", "cli.ts"),
      ...args,
    ],
    { cwd: root, env: { ...process.env, INIT_CWD: process.cwd() }, stdio: "inherit" },
  );
  // Ctrl+C reaches the CLI from the console itself; this process waits for its exit code.
  process.on("SIGINT", () => undefined);
  for (const signal of ["SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // The CLI has already exited.
      }
    });
  child.once("error", (error) => {
    process.stderr.write(`\ndoodlebot could not start the CLI: ${error.message}\n\n`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    process.exit(signal !== null ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 1));
  });
}
