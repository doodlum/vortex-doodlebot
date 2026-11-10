import { describe, expect, it } from "vitest";

import {
  NXM_COMMAND_KEY,
  NXM_KEY,
  defaultRegistry,
  readNxmHandler,
  restoreNxmHandler,
  restoreNxmHandlerOrWarn,
  type NxmRegistry,
} from "./nxmHandler";

/** An in-memory registry: key -> default value (undefined for a key without one). */
function fakeRegistry(initial: Record<string, string | undefined> = {}) {
  const keys = new Map(Object.entries(initial));
  const writes: string[] = [];
  const registry: NxmRegistry = {
    exists: (key) => [...keys.keys()].some((k) => k === key || k.startsWith(`${key}\\`)),
    readDefault: (key) => keys.get(key),
    writeDefault: (key, value) => {
      writes.push(`add ${key}=${value}`);
      keys.set(key, value);
    },
    deleteKey: (key) => {
      writes.push(`delete ${key}`);
      // Deleting the entry being visited is safe while iterating a Map.
      for (const k of keys.keys()) if (k === key || k.startsWith(`${key}\\`)) keys.delete(k);
    },
  };
  return { registry, keys, writes };
}

const owner = '"C:\\Program Files\\Vortex\\Vortex.exe" -d "%1"';
const harness = '"C:\\Users\\me\\.doodlebot\\releases\\2.8.0\\app\\Vortex.exe" -d "%1"';

describe("the nxm link handler", () => {
  it("never reaches the real registry from a unit test", () => {
    expect(defaultRegistry()).toBeUndefined();
    expect(readNxmHandler()).toBeUndefined();
    expect(restoreNxmHandler({ command: owner })).toBe(false);
  });

  it("writes back the command a launch recorded, after Vortex re-registered itself", () => {
    const fake = fakeRegistry({ [NXM_COMMAND_KEY]: owner });
    const saved = readNxmHandler(fake.registry);
    expect(saved).toEqual({ command: owner });
    fake.keys.set(NXM_COMMAND_KEY, harness);
    expect(restoreNxmHandler(saved!, fake.registry)).toBe(true);
    expect(fake.keys.get(NXM_COMMAND_KEY)).toBe(owner);
  });

  it("writes nothing when the handler is unchanged", () => {
    const fake = fakeRegistry({ [NXM_COMMAND_KEY]: owner });
    expect(restoreNxmHandler({ command: owner }, fake.registry)).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("deletes the key a launch created when there was none before", () => {
    const fake = fakeRegistry();
    const saved = readNxmHandler(fake.registry);
    expect(saved).toEqual({ absent: true });
    fake.keys.set(NXM_COMMAND_KEY, harness);
    expect(restoreNxmHandler(saved!, fake.registry)).toBe(true);
    expect(fake.writes).toEqual([`delete ${NXM_KEY}`]);
    expect(restoreNxmHandler(saved!, fake.registry)).toBe(false);
  });

  it("warns with the exact command when the write fails", () => {
    const fake = fakeRegistry({ [NXM_COMMAND_KEY]: harness });
    fake.registry.writeDefault = () => {
      throw new Error("access denied");
    };
    const warnings: string[] = [];
    restoreNxmHandlerOrWarn({ command: owner }, fake.registry, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("access denied");
    expect(warnings[0]).toContain(`reg add "${NXM_COMMAND_KEY}" /ve /d`);
  });
});
