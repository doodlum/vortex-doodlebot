/**
 * Opt-in check that a collection member whose download fails is installed by a resume:
 * doodlebot test collection-download-retry (fake Fallout 4: `up --bethesda-sandbox`).
 *
 * A required member downloads from a local server (a direct member) that resets every
 * connection until the first install has ended. Vortex retries the download itself, then marks
 * the member failed, and the review says incomplete. Once the server serves again, resuming
 * the collection must install the member. Fails when the first install claims complete, or the
 * resume doesn't install the member.
 */
import path from "node:path";

import { zipSync } from "fflate";

import { pluginBytes } from "../bethesdaSandbox";
import { loadConfig } from "../config";
import { startArchiveServer } from "../downloadServer";
import { VortexMcpClient } from "../mcpClient";
import {
  closeCollectionReviews,
  installOfflineCollection,
  resumeViaNotification,
  writeOfflineCollection,
} from "../offlineCollection";

const config = loadConfig();
const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
await mcp.waitUntilReady();
if ((await mcp.call<string | null>("vortex_query", { selector: "activeGameId" })) !== "fallout4")
  throw new Error("This check needs the fake Fallout 4: `doodlebot up --bethesda-sandbox`.");

const stamp = String(Date.now());
const plugin = `Direct${stamp}.esp`;
const archiveName = `Direct${stamp}.zip`;
const tag = `retry-direct-${stamp}`;
let failing = true;
const server = await startArchiveServer(
  { [archiveName]: zipSync({ [plugin]: new Uint8Array(pluginBytes({ name: plugin })) }) },
  { fail: () => failing },
);
const failures: string[] = [];
const result: Record<string, unknown> = {};

const installed = async (): Promise<boolean> =>
  Object.values(
    (await mcp.call<Record<string, { attributes?: { referenceTag?: string } }> | null>(
      "vortex_query",
      { path: ["persistent", "mods", "fallout4"] },
    )) ?? {},
  ).some((mod) => mod.attributes?.referenceTag === tag);

try {
  await closeCollectionReviews(mcp);
  const anchor = `Anchor${stamp}.esp`;
  const archive = writeOfflineCollection(
    path.join(config.cacheDir, `collection-download-retry-${stamp}.zip`),
    {
      name: `Download retry ${stamp}`,
      gameId: "fallout4",
      members: [{ name: `Anchor${stamp}`, files: { [anchor]: pluginBytes({ name: anchor }) } }],
      direct: [
        { name: `Direct${stamp}`, url: server.url(archiveName), tag, plugins: [{ name: plugin }] },
      ],
    },
  );
  const first = await installOfflineCollection(mcp, archive, { allowIncomplete: true });
  result.firstInstall = first.outcome;
  result.failedAttempts = server.hits.filter((hit) => hit.failed).length;
  if (first.outcome !== "incomplete")
    failures.push(`the first install said "${first.outcome}" with the member's download failing`);
  if (await installed()) failures.push("the member was installed although every download failed");

  failing = false;
  await resumeViaNotification(mcp, first.collectionModId);
  const deadline = Date.now() + 180_000;
  while (!(await installed()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  result.installedAfterResume = await installed();
  if (result.installedAfterResume !== true)
    failures.push("resuming the collection did not install the member whose download had failed");
  await closeCollectionReviews(mcp);
} finally {
  await server.close();
}

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("PASS: a member whose download failed was installed by the resume.");
process.exit(0);
