import fs from "node:fs";
import path from "node:path";
import { parseLogLine } from "../vortexLog";

/** Inspect only this fixture's logs, after its apps have closed and flushed them. */
export function assertNoUnrecoverableErrors(cacheDir: string): void {
  const failures: string[] = [];
  function inspect(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) inspect(file);
      else if (entry.isFile() && /^vortex(?:\d+)?\.log(?:\.\d+)?$/.test(entry.name)) {
        for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
          const parsed = parseLogLine(line);
          if (parsed && /^unrecoverable error(?:\s|$)/.test(parsed.message)) {
            const error = parsed.data?.error as { message?: unknown } | undefined;
            const message =
              typeof error?.message === "string"
                ? error.message
                : typeof parsed.data?.message === "string"
                  ? parsed.data.message
                  : parsed.message;
            failures.push(`${file}: ${parsed.time} [${parsed.process}] ${message}`);
          }
        }
      }
    }
  }
  inspect(cacheDir);
  if (failures.length > 0) {
    throw new Error(
      `Vortex reported unrecoverable errors in this fixture:\n${failures.join("\n")}`,
    );
  }
}
