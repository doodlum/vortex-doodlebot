/**
 * One synchronous git helper for the checkout code (config, check, the build record): a
 * command's trimmed output, or undefined when git fails or isn't installed. A leaf module, so
 * any module can use it without import cycles.
 */
import { execFileSync } from "node:child_process";

export function gitText(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return undefined;
  }
}
