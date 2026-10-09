import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig, resolveTargetSafely } from "../harness/src/config";
import { DEFAULT_CACHE_DIR } from "../harness/src/paths";
import { authCacheFile, stopStaleInstance } from "../harness/src/instance";
import { bootstrap, captureLogin } from "../harness/src/bootstrap";
import { requireOAuth, waitForOAuth } from "../harness/src/auth";
import { withLiveOperation } from "../harness/src/liveOperation";
import { beginOAuthCache } from "../harness/benchmarks/credentials";
import { holdLease } from "../harness/src/lease";
import { exploratoryManifest } from "./config";
import { pinnedCollections } from "./collections";
import {
  benchmarkSetupFile,
  readBenchmarkSetup,
  writeBenchmarkSetup,
  discoverBenchmarkGames,
  cachedAccountStatus,
  findBenchmarkAccountCache,
  prepareCollection,
  verifyPreparedSnapshot,
} from "./setup";
import type { CollectionCode } from "./types";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => !["--status", "--verify", "--help"].includes(arg)))
  throw new Error("Use pnpm run setup, setup -- --status, or setup -- --status --verify.");
const target = resolveTargetSafely({ preferInstalled: true });
const accountCache = findBenchmarkAccountCache(
  authCacheFile(loadConfig({ target, cacheDir: DEFAULT_CACHE_DIR })),
);
const owner = `human-setup-${process.pid}`;
function showStatus() {
  const setup = readBenchmarkSetup();
  console.log("\nDoodlebot setup\n");
  console.log(
    `Vortex: ${fs.existsSync(target.executable) ? target.executable : "Not found. Install released Vortex, then run setup again."}`,
  );
  console.log("Local tests: no account or installed game required. Run pnpm run benchmark:smoke.");
  console.log(
    `Nexus login: ${cachedAccountStatus(accountCache)} (local cache only; download access is checked during a real run).`,
  );
  if (setup.account)
    console.log(
      `Last Vortex account observation: ${setup.account.premium ? "Premium" : "not Premium"}, ${setup.account.checkedAt}. This is not a current server-access check.`,
    );
  for (const game of discoverBenchmarkGames())
    console.log(
      `${game.name}: ${game.directory ?? "not found in Steam; setup accepts another directory"}`,
    );
  for (const snapshot of setup.snapshots)
    console.log(
      `Snapshot ${snapshot.id}: ${fs.existsSync(snapshot.directory) ? "present" : "missing"}; ${snapshot.edition ?? snapshot.gameId}; ${(snapshot.bytes / 2 ** 30).toFixed(1)} GiB; last full verification ${snapshot.verifiedAt}\n  ${snapshot.directory}`,
    );
  if (!setup.snapshots.length) console.log("Snapshots: none prepared.");
  for (const collection of setup.collections)
    console.log(
      `${collection.code}: revision ${pinnedCollections[collection.code].url.split("/").at(-1)}; ${collection.warningsAsErrors ? "warnings fail" : "warnings allowed"}; snapshot ${collection.snapshotId}`,
    );
  console.log(`Local choices: ${benchmarkSetupFile}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function signIn() {
  const config = loadConfig({
    target,
    owner,
    apiKey: undefined,
    cacheDir: path.join(DEFAULT_CACHE_DIR, "setup-login"),
    mcpPort: await freePort(),
    cdpPort: await freePort(),
  });
  return withLiveOperation(config, "guided Nexus login", async (context) => {
    fs.mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
    if (!fs.existsSync(accountCache))
      fs.writeFileSync(accountCache, "null", { flag: "wx", mode: 0o600 });
    fs.mkdirSync(config.cacheDir, { recursive: true });
    const credentialLease = beginOAuthCache(accountCache, authCacheFile(config));
    try {
      const result = await bootstrap(config, {
        context,
        skipGame: true,
        fresh: true,
        onProgress: console.log,
      });
      const auth = await result.instance.mcp.call<{
        oauthPresent: boolean;
        oauthRefreshable: boolean;
      }>("nexus_auth_status");
      if (!auth.oauthPresent || !auth.oauthRefreshable) {
        console.log(
          "In the new Vortex window, click Log in and finish the browser login. Waiting up to ten minutes.",
        );
        await waitForOAuth(result.instance.mcp);
      }
      await captureLogin(config, { context, onProgress: console.log });
      const restored = await bootstrap(config, {
        context,
        skipGame: true,
        fresh: true,
        onProgress: console.log,
      });
      await requireOAuth(restored.instance.mcp);
      const premium = await restored.instance.mcp.call<boolean>("vortex_query", {
        path: ["persistent", "nexus", "userInfo", "isPremium"],
      });
      return { checkedAt: new Date().toISOString(), premium: premium === true };
    } finally {
      // If shutdown fails, preserve the profile and cache reservation; do not rotate a live token.
      await stopStaleInstance(config, { context });
      credentialLease.finish();
    }
  });
}
if (args.includes("--help")) {
  console.log(
    "pnpm run setup                 Guided local test or real collection preparation\npnpm run setup -- --status     Show saved login, games and snapshots; no app launch\npnpm run setup -- --status --verify  Recheck every saved snapshot's bytes\nNo collection downloads start during setup. Prepared choices are private and reusable.",
  );
} else if (args.includes("--status")) {
  if (args.includes("--verify")) {
    const lock = holdLease(
      `benchmark-setup:${path.resolve(benchmarkSetupFile).toLowerCase()}`,
      owner,
      { purpose: "verify saved game snapshots" },
    );
    try {
      const setup = readBenchmarkSetup();
      for (const snapshot of setup.snapshots) {
        await verifyPreparedSnapshot(snapshot);
        snapshot.verifiedAt = new Date().toISOString();
        console.log(`Verified: ${snapshot.id}`);
      }
      writeBenchmarkSetup(setup);
    } finally {
      lock.release();
    }
  }
  showStatus();
} else {
  if (args.includes("--verify")) throw new Error("Use --status --verify to check saved snapshots.");
  if (!stdin.isTTY)
    throw new Error(
      "Guided setup needs an interactive terminal. Use --status for a read-only summary, or prepareCollection() from TypeScript.",
    );
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    showStatus();
    const task = (
      await terminal.question(
        "\nWhat do you want to do? [1] Local test (default) [2] Prepare a real collection: ",
      )
    ).trim();
    if (!task || task === "1") {
      if (!fs.existsSync(target.executable))
        throw new Error("Install released Vortex before running the local test.");
      const example = "my-first-test.mts";
      if (!fs.existsSync(example))
        fs.writeFileSync(
          example,
          'import { expect } from "@playwright/test";\nimport { withVortex } from "./harness/benchmarks/index";\n\nawait withVortex({}, async (vortex) => {\n  await vortex.seedMods(3);\n  await vortex.openPage("Mods");\n  const search = vortex.page.locator("#table-mods .header-name input");\n  const rows = vortex.page.locator("#table-mods tr[data-rowid]");\n  await expect(rows).toHaveCount(3);\n  await search.fill("no-matching-mod");\n  await expect(rows).toHaveCount(0);\n  await search.fill("");\n  await expect(rows).toHaveCount(3);\n});\nconsole.log("Passed: the Mods search filters and restores three rows.");\n',
          { flag: "wx" },
        );
      console.log(
        `\n${example} is ready. Existing files are left untouched.\nRun: pnpm exec tsx ${example}\nFor a timed local run: pnpm run benchmark:smoke`,
      );
    } else if (task === "2") {
      if (!fs.existsSync(target.executable))
        throw new Error("Install released Vortex before preparing a collection.");
      console.log(
        "Real collections need Premium, a clean game, space for its snapshot plus a working copy, archives and staging, and a QA-only Windows account/test machine. Installs can take hours.",
      );
      const dedicated = await terminal.question(
        "Is this a QA-only Windows account or test machine? Type yes: ",
      );
      if (dedicated.trim().toLowerCase() !== "yes")
        throw new Error(
          "Real preparation stopped. Use local tests on your normal Windows account.",
        );
      console.log(
        "C1: Immersive and Adult, revision 104\nC2: Gate to Sovngarde, revision 118, base Skyrim, skip optionals\nC2-AE: Gate to Sovngarde, revision 118, paid Anniversary content, install optionals\nC3: Constellations, revision 121, paid content and separately prepared downgrade required\nC5: Night City: Femme Fatale PLUS, revision 94",
      );
      const selected =
        (await terminal.question("Collection code [C2]: ")).trim().toUpperCase() || "C2";
      if (!(selected in pinnedCollections))
        throw new Error("Choose one of the listed collection codes.");
      const code = selected as CollectionCode;
      const setup = readBenchmarkSetup();
      const game = discoverBenchmarkGames().find(
        (item) => item.id === pinnedCollections[code].gameId,
      )!;
      console.log(`Detected ${game.name}: ${game.directory ?? "not found"}`);
      const reuse = setup.collections.find((item) => item.code === code);
      const saved = setup.snapshots.find((item) => item.id === reuse?.snapshotId);
      let snapshot: string | undefined;
      let source: string | undefined;
      if (
        saved &&
        (await terminal.question(`Reuse ${saved.directory} after verifying it? [Y/n]: `))
          .trim()
          .toLowerCase() !== "n"
      )
        snapshot = saved.directory;
      if (!snapshot) {
        snapshot =
          (
            await terminal.question(
              "Existing verified snapshot to register, or Enter to copy the installed game: ",
            )
          ).trim() || undefined;
        if (!snapshot) {
          if (code === "C3")
            throw new Error(
              "Constellations requires a separately downgraded verified snapshot. Prepare that first, then run setup and register it.",
            );
          source =
            (
              await terminal.question(
                `Game source directory [${game.directory ?? "enter a directory"}]: `,
              )
            ).trim() || game.directory;
          if (!source)
            throw new Error("No installed game selected. Install it or provide its directory.");
          const free = fs.statfsSync(path.dirname(DEFAULT_CACHE_DIR));
          console.log(
            `Snapshot volume has ${((free.bavail * free.bsize) / 2 ** 30).toFixed(1)} GiB available. A run also needs a game copy, downloads and staging.`,
          );
        }
      }
      const clean = await terminal.question(
        "Is the selected source/snapshot clean, with the game, updates and content downloads closed? Type yes: ",
      );
      if (clean.trim().toLowerCase() !== "yes")
        throw new Error(
          "Finish preparing the clean game, then run setup again. Completed snapshots stay saved.",
        );
      const strict =
        (await terminal.question("Fail on every warning? [y/N]: ")).trim().toLowerCase() === "y";
      console.log(
        "Checking the login in an isolated Vortex. This does not download the collection.",
      );
      const account = await signIn();
      if (!account.premium)
        throw new Error(
          "Vortex does not report a Premium account. This unattended collection runner requires Premium; no snapshot was created.",
        );
      console.log(
        "Preparing and checking the game snapshot. Existing snapshots are verified in full; partial copies are never reused.",
      );
      await prepareCollection({
        code,
        source,
        snapshot,
        dedicatedWindowsAccount: true,
        cleanSource: true,
        authCache: accountCache,
        owner,
        warningsAsErrors: strict,
      });
      const lock = holdLease(
        `benchmark-setup:${path.resolve(benchmarkSetupFile).toLowerCase()}`,
        owner,
        { purpose: "record account observation" },
      );
      try {
        const updated = readBenchmarkSetup();
        updated.account = account;
        writeBenchmarkSetup(updated);
      } finally {
        lock.release();
      }
      console.log(
        `\nPrepared ${code}. Collection downloads have not started.\nRun one exploratory cold install: pnpm run benchmark -- --exploratory --repeats=1 --timeout-minutes=360 --select=B1-${code}\nCheck saved choices: pnpm run setup -- --status`,
      );
      console.log(
        `For TypeScript: import { preparedCollection } from "./benchmarks/setup";\nconst collection = preparedCollection("${code}");`,
      );
      console.log(`Exploratory hardware profile: ${exploratoryManifest().profile.hardware}`);
    } else throw new Error("Choose 1 or 2.");
  } finally {
    terminal.close();
  }
}
