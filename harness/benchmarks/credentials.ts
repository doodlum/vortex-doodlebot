import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BenchmarkBlocked } from "./types";

export interface OAuthCacheLease {
  finish(): void;
}

/** Opaque cache transfer. Never parses, logs or reports credential contents. */
export function beginOAuthCache(canonicalInput: string, localFile: string): OAuthCacheLease {
  const canonical = fs.realpathSync(path.resolve(canonicalInput));
  const lock = `${canonical}.benchmark-lock`;
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new BenchmarkBlocked(
        "This Nexus OAuth cache is reserved by another benchmark. Close its retained Vortex instance before retrying; never run overlapping sessions with the same refresh token.",
      );
    throw error;
  }
  fs.closeSync(descriptor);
  const digest = (file: string) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let initial: string;
  try {
    initial = digest(canonical);
    fs.copyFileSync(canonical, localFile);
  } catch (error) {
    fs.rmSync(lock, { force: true });
    throw error;
  }
  let finished = false;
  return {
    finish: () => {
      if (finished) return;
      // The caller confirms the owned app has exited before saving its last rotation.
      if (digest(canonical) !== initial)
        throw new Error(
          "The private Nexus OAuth cache changed during this benchmark; preserve the local cache and resolve concurrent credential use before retrying.",
        );
      const temporary = `${canonical}.benchmark-${crypto.randomUUID()}.tmp`;
      try {
        fs.copyFileSync(localFile, temporary);
        fs.chmodSync(temporary, 0o600);
        fs.renameSync(temporary, canonical);
      } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
      }
      fs.rmSync(lock, { force: true });
      finished = true;
    },
  };
}
