/**
 * One import for a scratch script run against the kit (`doodlebot script <file.mts>`).
 *
 * A script outside this repo cannot resolve the kit's dependencies by bare name (they live
 * in this repo's node_modules), and on Windows an absolute path in an import must be a
 * `file:///C:/...` URL. So it imports this file once, by the URL `doodlebot script` puts in
 * VORTEX_AI_KIT, and gets the harness modules and the zip helpers from here:
 *
 *   const kit: typeof import("file:///C:/dev/doodlebot/harness/src/kit.ts") =
 *     await import(process.env.VORTEX_AI_KIT!);
 *   const config = kit.loadConfig();
 *   const mcp = kit.clientFor(config);
 *
 * Anything a script proves useful belongs in a harness module with a test, not in the
 * scratch file (harness/AGENT-WORKFLOW.md, "Improve from verified lessons").
 */
import type { HarnessConfig } from "./config";
import { VortexMcpClient } from "./mcpClient";

export { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export { loadConfig, type HarnessConfig } from "./config";
export { VortexMcpClient };
export { attachToRenderer, captureScreenshot, realHover, realWheel } from "./cdp";
export { claimInstanceLease } from "./instance";
export { readJsonFile, parseJson } from "./jsonFile";

export * as bethesda from "./bethesdaSandbox";
export * as collectionScale from "./collectionScale";
export * as collectionDownloads from "./collectionDownloads";
export * as deployment from "./deployment";
export * as downloads from "./downloadServer";
export * as largeLibrary from "./largeLibrary";
export * as localMod from "./localMod";
export * as offlineCollection from "./offlineCollection";
export * as profiling from "./profiling";
export * as recording from "./recording";
export * as slowDownload from "./slowDownload";
export * as tableProbes from "./tableProbes";
export * as ui from "./uiDriver";
export * as vortexLog from "./vortexLog";

/** An MCP client for the configured instance. */
export function clientFor(config: HarnessConfig): VortexMcpClient {
  return new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
}
