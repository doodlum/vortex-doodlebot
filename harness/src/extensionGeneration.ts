/** Captured extension inputs and verified, replaceable build generations. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const GENERATION_FILE = ".doodlebot-generation.json";
export const EXTENSION_CONFIG_INPUTS = [
  "tsup.config.ts",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
  "info.json",
];

export interface ExtensionInputs {
  files: Readonly<Record<string, Buffer | null>>;
  digest: string;
}

export interface ExtensionGeneration {
  version: 1;
  inputDigest: string;
  outputDigest: string;
}

export class ExtensionGenerationError extends Error {}
export class ExtensionInputsChangedError extends Error {}

function missing(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");
}

function filesIn(dir: string, production: boolean): string[] {
  const result: string[] = [];
  const visit = (current: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new ExtensionGenerationError(
          `Extension inputs/output cannot contain a symlink: ${current}`,
        );
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (
        production &&
        (["test", "tests", "__tests__"].includes(entry.name) ||
          /\.(?:test|spec)\./.test(entry.name))
      )
        continue;
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink())
        throw new ExtensionGenerationError(
          `Extension build inputs/output cannot contain a symlink: ${path.join(current, entry.name)}`,
        );
      if (entry.isDirectory()) visit(path.join(current, entry.name), relative + "/");
      else if (entry.isFile()) result.push(relative);
    }
  };
  visit(dir, "");
  return result.toSorted();
}

function digestFiles(files: Readonly<Record<string, Buffer | null>>, environment = ""): string {
  const hash = createHash("sha256").update(environment);
  for (const file of Object.keys(files).toSorted()) {
    const bytes = files[file];
    hash.update(
      JSON.stringify([
        file,
        bytes === null || bytes === undefined
          ? null
          : createHash("sha256").update(bytes).digest("hex"),
      ]),
    );
  }
  return hash.digest("hex");
}

/** Hash exactly these captured bytes; the compiler receives copies of this same capture. */
export function captureExtensionInputs(source: string): ExtensionInputs {
  const names = [
    ...EXTENSION_CONFIG_INPUTS,
    ...filesIn(path.join(source, "src"), true).map((file) => "src/" + file),
  ];
  const files: Record<string, Buffer | null> = {};
  for (const file of names) {
    try {
      const absolute = path.join(source, file);
      if (fs.lstatSync(absolute).isSymbolicLink())
        throw new ExtensionGenerationError(`Extension input cannot be a symlink: ${absolute}`);
      files[file] = fs.readFileSync(absolute);
    } catch (error) {
      if (!missing(error)) throw error;
      files[file] = null;
    }
  }
  // Installed dependencies are provisioned under the kit lock; package/lock bytes bind their
  // declared versions. The current config has no other external inputs or environment reads.
  const environment = JSON.stringify([
    1,
    process.version,
    process.platform,
    process.arch,
    process.env.NODE_ENV ?? null,
  ]);
  return { files, digest: digestFiles(files, environment) };
}

export function writeExtensionInputs(stage: string, inputs: ExtensionInputs): void {
  for (const [file, bytes] of Object.entries(inputs.files)) {
    if (bytes === null) continue;
    const target = path.join(stage, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function outputDigest(dir: string): string {
  const files: Record<string, Buffer> = {};
  for (const file of filesIn(dir, false)) {
    if (file !== GENERATION_FILE) files[file] = fs.readFileSync(path.join(dir, file));
  }
  if (
    files["index.js"] === undefined ||
    files["index.js"].length === 0 ||
    files["info.json"] === undefined ||
    files["package.json"] === undefined
  )
    throw new ExtensionGenerationError(`Incomplete extension generation at ${dir}.`);
  return digestFiles(files);
}

export function sealExtensionGeneration(dir: string, inputDigest: string): ExtensionGeneration {
  const generation: ExtensionGeneration = {
    version: 1,
    inputDigest,
    outputDigest: outputDigest(dir),
  };
  fs.writeFileSync(path.join(dir, GENERATION_FILE), JSON.stringify(generation) + "\n");
  return generation;
}

/** The marker is content validation/provenance, not a signature or proof of dependency integrity. */
export function verifyExtensionGeneration(dir: string): ExtensionGeneration {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, GENERATION_FILE), "utf8"),
    ) as Partial<ExtensionGeneration>;
    if (
      raw.version !== 1 ||
      typeof raw.inputDigest !== "string" ||
      !/^[a-f\d]{64}$/.test(raw.inputDigest) ||
      raw.outputDigest !== outputDigest(dir)
    )
      throw new Error("generation identity differs from its output");
    return raw as ExtensionGeneration;
  } catch (cause) {
    throw new ExtensionGenerationError(
      `No verified extension generation at ${dir}; rebuild the extension.`,
      { cause },
    );
  }
}

export function requireFreshExtension(source: string): ExtensionGeneration {
  const generation = verifyExtensionGeneration(path.join(source, "dist"));
  if (generation.inputDigest !== captureExtensionInputs(source).digest)
    throw new ExtensionInputsChangedError(
      "Extension inputs changed; build a fresh generation before installing.",
    );
  return generation;
}

export function extensionIsFresh(source: string): boolean {
  try {
    requireFreshExtension(source);
    return true;
  } catch (error) {
    if (error instanceof ExtensionGenerationError || error instanceof ExtensionInputsChangedError)
      return false;
    throw error;
  }
}

/** Same-filesystem backup/swap. A failed rollback retains its named backup for manual recovery. */
export function replaceExtensionDirectory(
  staged: string,
  target: string,
  recoveryDir = path.dirname(target),
): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const backup = path.join(recoveryDir, `.${path.basename(target)}-backup-${randomUUID()}`);
  const previous = fs.existsSync(target);
  if (previous) fs.renameSync(target, backup);
  try {
    fs.renameSync(staged, target);
  } catch (cause) {
    if (previous) {
      try {
        fs.renameSync(backup, target);
      } catch (rollback) {
        throw new AggregateError(
          [cause, rollback],
          `Extension promotion and rollback failed. Previous generation retained at ${backup}; recover it before retrying.`,
          { cause: rollback },
        );
      }
    }
    throw cause;
  }
  if (previous) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      process.stderr.write(
        `Extension published; previous generation could not be removed: ${backup}\n`,
      );
    }
  }
}
