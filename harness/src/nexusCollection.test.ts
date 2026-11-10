import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContent, recordCollection, type Content } from "./content";
import { NO_COLLECTION, resolveNexusCollection } from "./nexusCollection";

let root: string;
let file: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-collection-"));
  file = path.join(root, "content.json");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const empty = (): Content => readContent(file);

describe("test nexus --collection", () => {
  it("refuses when neither the argument nor content.json names a collection", () => {
    expect(() => resolveNexusCollection(["--installed"], empty())).toThrow(NO_COLLECTION);
    expect(NO_COLLECTION).not.toContain("nudx7b");
  });

  it("takes <game>/<slug> or a URL from the argument, with an optional revision", () => {
    expect(resolveNexusCollection(["--collection", "stardewvalley/abc123"], empty())).toEqual({
      gameId: "stardewvalley",
      slug: "abc123",
      url: "https://www.nexusmods.com/games/stardewvalley/collections/abc123",
      source: "argument",
    });
    expect(
      resolveNexusCollection(
        [
          "--installed",
          "--collection=https://www.nexusmods.com/games/stardewvalley/collections/abc123/revisions/4",
        ],
        empty(),
      ),
    ).toMatchObject({ slug: "abc123", revision: 4, url: expect.stringMatching(/revisions\/4$/) });
    expect(
      resolveNexusCollection(["--collection", "stardewvalley/abc123", "--revision", "2"], empty()),
    ).toMatchObject({ revision: 2 });
    expect(() =>
      resolveNexusCollection(["--collection", "stardewvalley/abc123", "--revision", "x"], empty()),
    ).toThrow(/--revision must be a number/);
    expect(() => resolveNexusCollection(["--collection"], empty())).toThrow(/needs a value/);
  });

  it("refuses a game it cannot make a disposable folder for", () => {
    expect(() => resolveNexusCollection(["--collection", "nosuchgame/abc"], empty())).toThrow(
      /not one it knows/,
    );
  });

  it("uses content.json: a bare recorded slug, or the newest recorded collection", () => {
    recordCollection(
      { gameId: "stardewvalley", slug: "older", revision: 1 },
      file,
      new Date("2026-11-01T00:00:00Z"),
    );
    recordCollection({ gameId: "fallout4", slug: "newer" }, file, new Date("2026-11-09T00:00:00Z"));
    expect(resolveNexusCollection([], readContent(file))).toMatchObject({
      gameId: "fallout4",
      slug: "newer",
      source: "content.json",
    });
    expect(resolveNexusCollection(["--collection", "OLDER"], readContent(file))).toMatchObject({
      gameId: "stardewvalley",
      slug: "older",
      revision: 1,
      source: "argument",
    });
    expect(() => resolveNexusCollection(["--collection", "unknown"], readContent(file))).toThrow(
      /name its game too/,
    );
  });

  it("recordCollection replaces the same game and slug", () => {
    recordCollection({ gameId: "fallout4", slug: "abc", revision: 1 }, file);
    recordCollection({ gameId: "fallout4", slug: "ABC", revision: 2 }, file);
    expect(readContent(file).collections).toEqual([
      expect.objectContaining({ gameId: "fallout4", slug: "ABC", revision: 2 }),
    ]);
  });
});
