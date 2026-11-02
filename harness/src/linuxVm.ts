/** SSH transport for a native Linux harness; all app operations execute in the guest. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { zipSync } from "fflate";
import { ConfigError } from "./errors";
import { REPO_ROOT } from "./paths";
import { requireNamedOwner } from "./lease";
import { withOperations } from "./operations";
import type { LeaseEnv } from "./lease";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";

export interface LinuxVmOptions {
  host: string;
  directory: string;
  owner: string;
  /** Explicit untracked source files to include with the tracked working tree. */
  include?: string[];
  onOutput?: (chunk: Buffer) => void;
}

export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new ConfigError("Remote arguments cannot contain NUL.");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function validateLinuxVm(options: LinuxVmOptions): void {
  requireNamedOwner(options.owner);
  // SSH config aliases, hostnames, IPv4 and user@host. Options/IPv6 need an SSH alias.
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(options.host))
    throw new ConfigError(
      "--host must be an SSH alias or user@hostname (configure ports in SSH config).",
    );
  if (
    !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(options.directory) ||
    options.directory.split("/").some((part) => part === "." || part === "..")
  )
    throw new ConfigError(
      "--directory must be an absolute Linux path without spaces or traversal.",
    );
}

/** SSH never prompts, accepts unknown host keys, or forwards the host's environment. */
export function sshArgs(host: string, command: string): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    host,
    command,
  ];
}

export function linuxVmCommand(options: LinuxVmOptions, args: string[]): string {
  validateLinuxVm(options);
  if (args.length === 0) throw new ConfigError("vm run needs harness arguments after --.");
  if (args[0] === "vm") throw new ConfigError("Nested vm commands are not supported.");
  // A login shell supplies a user-installed pnpm. No host operation context crosses machines.
  return (
    "bash -lc " +
    shellQuote(
      `set -e; cd ${shellQuote(options.directory)}; ` +
        `unset VORTEX_AI_OPERATION_CONTEXT; export VORTEX_AI_OWNER=${shellQuote(options.owner)}; ` +
        `exec pnpm run ai -- ${args.map(shellQuote).join(" ")}`,
    )
  );
}

export async function inspectLinuxVm(options: LinuxVmOptions): Promise<number> {
  validateLinuxVm(options);
  return remote(
    options,
    "bash -lc " +
      shellQuote(
        'set -e; test "$(uname -s)" = Linux; uname -srm; cat /etc/os-release; ' +
          "df -h /; free -h; " +
          'for tool in git python3 node pnpm dotnet; do command -v "$tool" || true; done; ' +
          "loginctl list-sessions --no-pager",
      ),
  );
}

export async function runLinuxVm(options: LinuxVmOptions, args: string[]): Promise<number> {
  return remote(options, linuxVmCommand(options, args));
}

export interface LinuxDesktopOptions extends LinuxVmOptions {
  /** Private guest directory; credentials never cross SSH. */
  desktopCacheDir?: string;
  leaseEnv?: LeaseEnv;
}

export function linuxDesktopCommand(options: LinuxDesktopOptions): string {
  validateLinuxVm(options);
  if (options.desktopCacheDir !== undefined)
    validateLinuxVm({ ...options, directory: options.desktopCacheDir });
  const args = ["--owner", options.owner];
  if (options.desktopCacheDir !== undefined) args.push("--cache-dir", options.desktopCacheDir);
  return (
    "bash -lc " +
    shellQuote(
      `set -e; cd ${shellQuote(options.directory)}; unset VORTEX_AI_OPERATION_CONTEXT; ` +
        `exec python3 -u harness/linux_desktop.py ${args.map(shellQuote).join(" ")}`,
    )
  );
}

/** JSON-lines input over SSH; the guest portal owns consent and token rotation. */
export async function runLinuxDesktop(options: LinuxDesktopOptions): Promise<number> {
  const command = linuxDesktopCommand(options);
  return withOperations(
    [`vm-desktop:${options.host}`],
    options.owner,
    { leaseEnv: options.leaseEnv },
    async (context) => {
      const cancellation = abortOnSignals();
      try {
        const result = await runEvidenceProcess({
          executable: "ssh",
          args: ["-T", ...sshArgs(options.host, command)],
          cwd: REPO_ROOT,
          context,
          leaseEnv: options.leaseEnv,
          input: process.stdin,
          signal: cancellation.signal,
          onOutput: options.onOutput,
        });
        return result.aborted ? 130 : (result.code ?? 1);
      } finally {
        cancellation.dispose();
      }
    },
  );
}

async function remote(options: LinuxVmOptions, command: string): Promise<number> {
  validateLinuxVm(options);
  const cancellation = abortOnSignals();
  try {
    const result = await runEvidenceProcess({
      executable: "ssh",
      args: sshArgs(options.host, command),
      cwd: REPO_ROOT,
      signal: cancellation.signal,
      onOutput: options.onOutput,
    });
    return result.aborted ? 130 : (result.code ?? 1);
  } finally {
    cancellation.dispose();
  }
}

/** Bundle committed history plus a binary working-tree patch; untracked files are opt-in. */
export async function deployLinuxVm(options: LinuxVmOptions): Promise<number> {
  validateLinuxVm(options);
  return withOperations(
    [`vm-deploy:${options.host}:${options.directory}`],
    options.owner,
    {},
    async (context) => {
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-vm-"));
      const cancellation = abortOnSignals();
      const run = async (executable: string, args: string[], quiet = false) => {
        const result = await runEvidenceProcess({
          executable,
          args,
          cwd: REPO_ROOT,
          context,
          signal: cancellation.signal,
          onOutput: quiet ? undefined : options.onOutput,
        });
        if (result.aborted || result.code !== 0)
          throw new ConfigError(
            `${executable} failed (${String(result.code)}). Failed guest directories are retained for inspection.`,
          );
        return result.stdout;
      };
      try {
        const bundle = path.join(stage, "source.bundle");
        await run("git", ["bundle", "create", bundle, "HEAD"]);
        // Read binary-safe patch output from Git's own file rather than decoded stdout.
        const patch = path.join(stage, "working.patch");
        await run("git", [
          "diff",
          "HEAD",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          `--output=${patch}`,
        ]);
        const entries: Record<string, Uint8Array> = {
          "source.bundle": fs.readFileSync(bundle),
          "working.patch": fs.readFileSync(patch),
        };
        const untracked = new Set(
          (await run("git", ["ls-files", "--others", "--exclude-standard", "-z"], true)).split(
            "\0",
          ),
        );
        for (const name of options.include ?? []) {
          if (
            !untracked.has(name) ||
            name.includes("\\") ||
            name.startsWith("/") ||
            name.split("/").some((part) => part === ".." || part.startsWith("."))
          )
            throw new ConfigError(
              `--include must name a nonignored, untracked source file: ${name}`,
            );
          const file = path.join(REPO_ROOT, name);
          if (!fs.lstatSync(file).isFile())
            throw new ConfigError(`Not a regular source file: ${name}`);
          entries[`new/${name}`] = fs.readFileSync(file);
        }
        const archive = zipSync(entries);
        const digest = createHash("sha256").update(archive).digest("hex");
        const local = path.join(stage, "deploy.zip");
        fs.writeFileSync(local, archive);
        const upload = `/tmp/doodlebot-${randomUUID()}.zip`;
        // Refuse an existing destination before uploading; mkdir below arbitrates races.
        await run("ssh", sshArgs(options.host, `test ! -e ${shellQuote(options.directory)}`));
        await run("scp", [
          "-q",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          local,
          `${options.host}:${upload}`,
        ]);
        const script = [
          "set -eu",
          'test "$(uname -s)" = Linux',
          "umask 077",
          `mkdir ${shellQuote(options.directory)}`,
          `cd ${shellQuote(options.directory)}`,
          // Inputs are generated locally; validate the transfer digest before unpacking.
          `printf '%s  %s\\n' ${shellQuote(digest)} ${shellQuote(upload)} | sha256sum -c -`,
          `python3 -c ${shellQuote("import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall('.transfer')")} ${shellQuote(upload)}`,
          "git init -q",
          "git fetch -q .transfer/source.bundle HEAD",
          "git checkout -q --detach FETCH_HEAD",
          "git apply --allow-empty --binary .transfer/working.patch",
          "if test -d .transfer/new; then cp -R .transfer/new/. .; fi",
          `printf '%s\\n' ${shellQuote(digest)} > .git/doodlebot-deployment-sha256`,
          "rm -r .transfer",
          `rm ${shellQuote(upload)}`,
          "printf 'Source deployed; install Linux dependencies, then run the guest harness.\\n'",
        ].join("; ");
        await run("ssh", sshArgs(options.host, "bash -lc " + shellQuote(script)));
        return 0;
      } finally {
        cancellation.dispose();
        fs.rmSync(stage, { recursive: true, force: true });
      }
    },
  );
}
