import type { CollectionCode, RealCollection } from "./types";

const gtsPin = {
  url: "https://www.nexusmods.com/games/skyrimspecialedition/collections/qdurkx/revisions/118",
  gameId: "skyrimse",
  engine: "Creation",
  expectedMods: 1976,
} as const;

/** Fixed on 8 October 2026. Updating a curator's collection never changes these pins. */
export const pinnedCollections = {
  C1: {
    url: "https://www.nexusmods.com/games/skyrimspecialedition/collections/xxsqm4/revisions/104",
    gameId: "skyrimse",
    engine: "Creation",
    expectedMods: 566,
  },
  C2: gtsPin,
  "C2-AE": gtsPin,
  C3: {
    url: "https://www.nexusmods.com/games/skyrimspecialedition/collections/9zfscf/revisions/121",
    gameId: "skyrimse",
    engine: "Creation",
    expectedMods: 2444,
  },
  C5: {
    url: "https://www.nexusmods.com/games/cyberpunk2077/collections/p0qfwm/revisions/94",
    gameId: "cyberpunk2077",
    engine: "REDengine 4",
    expectedMods: 2896,
  },
} as const;

export function realCollection(
  code: CollectionCode,
  machine: Omit<RealCollection, "url" | "gameId" | "engine" | "expectedMods">,
): RealCollection {
  return {
    warningsAsErrors: false,
    ...machine,
    ...pinnedCollections[code],
    ...(code === "C2"
      ? { skyrimEdition: "base" as const, optionalMods: "skip" as const }
      : code === "C2-AE"
        ? { skyrimEdition: "anniversary" as const, optionalMods: "install" as const }
        : {}),
  };
}

/** The two GTS workloads have separate results even though both pin revision 118. */
export function gtsCollection(
  edition: "base" | "anniversary",
  machine: Omit<
    RealCollection,
    "url" | "gameId" | "engine" | "expectedMods" | "skyrimEdition" | "optionalMods"
  >,
): RealCollection {
  return realCollection(edition === "base" ? "C2" : "C2-AE", machine);
}
