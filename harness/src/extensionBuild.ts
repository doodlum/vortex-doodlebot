import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extensionRoot, MCP_EXTENSION_ID } from "./config";
import {
  captureExtensionInputs,
  EXTENSION_CONFIG_INPUTS,
  ExtensionInputsChangedError,
  replaceExtensionDirectory,
  sealExtensionGeneration,
  writeExtensionInputs,
} from "./extensionGeneration";
import { normalizedPath, requireNamedOwner } from "./lease";
import { inheritedOperation, withOperations, type OperationOptions } from "./operations";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";

const require = createRequire(import.meta.url);
export const extensionOutputResource = (source = extensionRoot()): string =>
  "extension-output:" + normalizedPath(source);

export class ExtensionBuildError extends Error {}
export class ExtensionBuildCancelledError extends Error {}

export interface ExtensionBuildOptions extends OperationOptions {
  owner?: string;
  source?: string;
  needed?: () => boolean;
  signal?: AbortSignal;
  runner?: typeof runEvidenceProcess;
}

/** One finite compiler invocation; the guard outlives the child, including cancellation. */
export async function buildExtension(options: ExtensionBuildOptions = {}): Promise<void> {
  const owner = requireNamedOwner(options.owner);
  const source = options.source ?? extensionRoot();
  await withOperations(
    [extensionOutputResource(source)],
    owner,
    {
      ...options,
      context: options.context ?? inheritedOperation(owner, process.env, options.leaseEnv),
    },
    async (context) => {
      if (options.needed !== undefined && !options.needed()) return;
      const cancellation = abortOnSignals(options.signal);
      let stage: string | undefined;
      try {
        if (cancellation.signal.aborted) throw new ExtensionBuildCancelledError("Build cancelled.");
        const inputs = captureExtensionInputs(source);
        for (const file of ["src/index.ts", ...EXTENSION_CONFIG_INPUTS]) {
          if (inputs.files[file] === null || inputs.files[file] === undefined)
            throw new ExtensionBuildError(
              `Missing captured build input ${file}; restore it before building.`,
            );
        }
        const info = inputs.files["info.json"];
        try {
          if (
            info === null ||
            info === undefined ||
            JSON.parse(info.toString()).id !== MCP_EXTENSION_ID
          )
            throw new Error("missing or unexpected extension id");
        } catch (cause) {
          throw new ExtensionBuildError("The captured info.json must identify doodlebot.", {
            cause,
          });
        }
        const artifacts = path.join(source, "harness", ".artifacts");
        fs.mkdirSync(artifacts, { recursive: true });
        stage = fs.mkdtempSync(path.join(artifacts, "extension-build-"));
        writeExtensionInputs(stage, inputs);
        const result = await (options.runner ?? runEvidenceProcess)({
          executable: process.execPath,
          args: [require.resolve("tsup/dist/cli-default.js")],
          cwd: stage,
          env: process.env,
          context,
          leaseEnv: options.leaseEnv,
          signal: cancellation.signal,
          onOutput: (chunk) => process.stdout.write(chunk),
        });
        if (result.aborted || cancellation.signal.aborted)
          throw new ExtensionBuildCancelledError("Build cancelled after child exit.");
        if (result.code !== 0)
          throw new ExtensionBuildError("Extension build exited " + String(result.code) + ".");
        const output = path.join(stage, "dist");
        if (
          !fs.existsSync(path.join(output, "index.js")) ||
          fs.statSync(path.join(output, "index.js")).size === 0
        )
          throw new ExtensionBuildError("Extension build produced no dist/index.js.");
        fs.writeFileSync(path.join(output, "info.json"), info!);
        fs.writeFileSync(
          path.join(output, "package.json"),
          JSON.stringify({ name: MCP_EXTENSION_ID, type: "commonjs", main: "index.js" }) + "\n",
        );
        sealExtensionGeneration(output, inputs.digest);
        if (captureExtensionInputs(source).digest !== inputs.digest)
          throw new ExtensionInputsChangedError(
            "Extension inputs changed during the build; retry with the current inputs.",
          );
        if (cancellation.signal.aborted)
          throw new ExtensionBuildCancelledError("Build cancelled after child exit.");
        replaceExtensionDirectory(output, path.join(source, "dist"), artifacts);
      } finally {
        cancellation.dispose();
        // The process runner returns only after confirmed child exit. Recovery backups live
        // outside this private stage, so a failed rollback is never erased by cleanup.
        if (stage !== undefined) {
          try {
            fs.rmSync(stage, { recursive: true, force: true });
          } catch {
            process.stderr.write(
              `Temporary extension build retained at ${stage}; remove it after inspection.\n`,
            );
          }
        }
      }
    },
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  buildExtension().catch((error: unknown) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = error instanceof ExtensionBuildCancelledError ? 130 : 1;
  });
}
