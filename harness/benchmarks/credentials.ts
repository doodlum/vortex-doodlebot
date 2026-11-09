import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface OAuthCacheLease {
  finish(): void;
}

/** Opaque cache transfer. Never parses, logs or reports credential contents. */
export function beginOAuthCache(canonicalInput: string, localFile: string): OAuthCacheLease {
  const canonical = fs.realpathSync(path.resolve(canonicalInput));
  const digest = (file: string) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const initial = digest(canonical);
  fs.copyFileSync(canonical, localFile);
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
      finished = true;
    },
  };
}
