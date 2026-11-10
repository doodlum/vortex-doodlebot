/**
 * Which Nexus collection `doodlebot test nexus` installs (design 4.5: no check names fixed Nexus
 * content). It is the `--collection` argument, or else the newest Nexus collection recorded in
 * content.json; with neither, the check refuses instead of falling back to a pinned one.
 */
import { nexusCollectionDomain } from "./collectionIdentity";
import { parseCollectionRef, type CollectionRef } from "./collections";
import type { Content } from "./content";
import { ConfigError } from "./errors";
import { KNOWN_GAMES } from "./gameSetup";

export interface NexusCollectionTarget extends CollectionRef {
  /** The URL `installCollection` is given. */
  url: string;
  /** Where the collection came from, for the evidence. */
  source: "argument" | "content.json";
}

export const NO_COLLECTION =
  "test nexus needs a Nexus collection: pass --collection <game>/<slug> (or the collection's URL), " +
  "or install one once with `doodlebot collection <url>`, which records it in " +
  "~/.doodlebot/content.json. No collection is pinned.";

/** The value of `--name <value>` or `--name=<value>` in a suite's arguments. */
function flagValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--"))
        throw new ConfigError(`--${name} needs a value.`);
      return next;
    }
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return undefined;
}

const urlOf = (ref: CollectionRef): string =>
  `https://www.nexusmods.com/games/${nexusCollectionDomain(ref.gameId)}/collections/${ref.slug}` +
  (ref.revision === undefined ? "" : `/revisions/${String(ref.revision)}`);

/**
 * The collection to install. `--collection` takes `<game>/<slug>`, a collection URL, or a bare
 * slug that content.json records; `--revision <n>` pins a revision (otherwise the one given or
 * recorded, or the latest). Without `--collection`, the newest collection in content.json.
 */
export function resolveNexusCollection(argv: string[], content: Content): NexusCollectionTarget {
  const given = flagValue(argv, "collection");
  const revisionText = flagValue(argv, "revision");
  if (revisionText !== undefined && !/^\d+$/.test(revisionText))
    throw new ConfigError(`--revision must be a number, not "${revisionText}".`);
  let ref: CollectionRef;
  let source: NexusCollectionTarget["source"];
  if (given !== undefined) {
    source = "argument";
    if (/[/:]/.test(given)) ref = parseCollectionRef(given);
    else {
      const recorded = content.collections.find(
        (c) => c.slug.toLowerCase() === given.toLowerCase(),
      );
      if (recorded === undefined)
        throw new ConfigError(
          `No recorded collection has the slug "${given}"; name its game too: --collection <game>/${given}.`,
        );
      ref = {
        gameId: recorded.gameId,
        slug: recorded.slug,
        ...(recorded.revision === undefined ? {} : { revision: recorded.revision }),
      };
    }
  } else {
    source = "content.json";
    const newest = content.collections.toSorted((a, b) =>
      b.installedAt.localeCompare(a.installedAt),
    )[0];
    if (newest === undefined) throw new ConfigError(NO_COLLECTION);
    ref = {
      gameId: newest.gameId,
      slug: newest.slug,
      ...(newest.revision === undefined ? {} : { revision: newest.revision }),
    };
  }
  if (revisionText !== undefined) ref = { ...ref, revision: Number(revisionText) };
  if (KNOWN_GAMES[ref.gameId] === undefined)
    throw new ConfigError(
      `test nexus makes a disposable folder for the collection's game, and ${ref.gameId} is not ` +
        `one it knows (${Object.keys(KNOWN_GAMES).join(", ")}).`,
    );
  return { ...ref, url: urlOf(ref), source };
}
