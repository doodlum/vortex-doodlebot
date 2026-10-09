import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifySkyrimEdition, createSkyrimSnapshot, freeSkyrimCreations } from "./skyrimEdition";
import { anniversaryCreationPlugins } from "./skyrimCreationPlugins";

const roots: string[] = [];
function fixture(paid = false) {
  const base = path.resolve("harness/.artifacts/benchmark-unit-fixtures");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "skyrim-edition-"));
  roots.push(root);
  const data = path.join(root, "Data");
  fs.mkdirSync(data);
  for (const plugin of anniversaryCreationPlugins.filter(
    (name) => paid || freeSkyrimCreations.some((stem) => name.startsWith(stem)),
  )) {
    fs.writeFileSync(path.join(data, plugin), "unit plugin bytes");
    fs.writeFileSync(path.join(data, plugin.replace(/\.(esl|esm)$/, ".bsa")), "unit archive bytes");
  }
  return { root, data };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("accepts the four free Creations and rejects a paid archive even without its plugin", () => {
  const { root, data } = fixture();
  expect(verifySkyrimEdition(root, "base")).toMatchObject({
    creationPlugins: 4,
    paidContent: false,
  });
  fs.writeFileSync(path.join(data, "ccBGSSSE067-DaedInv.bsa"), "paid archive");
  expect(() => verifySkyrimEdition(root, "base")).toThrow("contains paid Creation files");
});
it("rejects the partial paid content download", () => {
  const { root } = fixture();
  expect(() => verifySkyrimEdition(root, "anniversary")).toThrow("download is incomplete");
});
it("derives both snapshots natively from one paid installation without deleting its files", async () => {
  const { root, data } = fixture(true);
  const base = `${root}-base`,
    ae = `${root}-ae`;
  roots.push(base, ae);
  roots.push(`${base}.doodlebot-snapshot.json`, `${ae}.doodlebot-snapshot.json`);
  const snapshot = await createSkyrimSnapshot({ source: root, destination: base, edition: "base" });
  expect(snapshot.excluded).toHaveLength(140);
  expect(verifySkyrimEdition(base, "base").paidContent).toBe(false);
  expect(fs.readFileSync(path.join(data, "ccBGSSSE067-DaedInv.bsa"), "utf8")).toBe(
    "unit archive bytes",
  );
  await createSkyrimSnapshot({ source: root, destination: ae, edition: "anniversary" });
  expect(verifySkyrimEdition(ae, "anniversary").creationPlugins).toBe(74);
});
it("rejects an incomplete paid source before creating the AE snapshot", async () => {
  const { root } = fixture();
  const destination = `${root}-ae`;
  roots.push(destination);
  await expect(
    createSkyrimSnapshot({ source: root, destination, edition: "anniversary" }),
  ).rejects.toThrow("download is incomplete");
  expect(fs.existsSync(destination)).toBe(false);
});
it.each(["missing", "empty", "linked"])("requires every paid plugin's main archive: %s", (mode) => {
  const { root, data } = fixture(true);
  expect(verifySkyrimEdition(root, "anniversary")).toMatchObject({
    creationPlugins: 74,
    creationArchives: 74,
    paidContent: true,
  });
  const archive = path.join(data, "ccBGSSSE067-DaedInv.bsa");
  fs.rmSync(archive);
  if (mode === "empty") fs.writeFileSync(archive, "");
  if (mode === "linked") {
    const target = path.join(root, "linked-target");
    fs.mkdirSync(target);
    fs.symlinkSync(target, archive, "junction");
  }
  expect(() => verifySkyrimEdition(root, "anniversary")).toThrow(
    mode === "linked" ? "linked game path" : "download is incomplete",
  );
});
