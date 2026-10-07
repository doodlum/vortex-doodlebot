import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { assertNoUnrecoverableErrors } from "./tests/appHealth";

let cacheDir: string;
beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-health-test-"));
});
afterEach(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

function log(relative: string, text: string): void {
  const file = path.join(cacheDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

it("rejects a fatal renderer error even when the app stayed connected", () => {
  log(
    "instance/userData/vortex.log",
    '2026-10-07T15:35:49.998Z [ERRO] [RENDERER] unrecoverable error {"error":{"message":"Cannot find module \'./common\'"},"process":"renderer"}\n',
  );
  expect(() => assertNoUnrecoverableErrors(cacheDir)).toThrow("Cannot find module './common'");
});

it("checks nested lifecycle profiles and rotated logs for fatal main-process errors", () => {
  log("instance/userData/vortex.log", "2026-10-07T15:00:00Z [INFO] [MAIN] startup complete\n");
  log(
    "lifecycle/live/userData/vortex1.log",
    '2026-10-07T15:01:00Z [ERRO] [MAIN] unrecoverable error {"message":"startup failed"}\n',
  );
  expect(() => assertNoUnrecoverableErrors(cacheDir)).toThrow("startup failed");
});

it("permits normal diagnostics and expected caught errors", () => {
  log(
    "instance/userData/vortex.log",
    "2026-10-07T15:00:00Z [WARN] [RENDERER] diagnostic probe\n" +
      "2026-10-07T15:01:00Z [INFO] [MAIN] Uncaught UserCanceled: canceled by user\n" +
      "2026-10-07T15:02:00Z [ERRO] [RENDERER] handled error\n",
  );
  expect(() => assertNoUnrecoverableErrors(cacheDir)).not.toThrow();
});

it("rejects an unrecoverable error even when its structured details are incomplete", () => {
  log(
    "instance/userData/vortex.log.1",
    '2026-10-07T15:35:49.998Z [ERRO] [RENDERER] unrecoverable error {"error":',
  );
  expect(() => assertNoUnrecoverableErrors(cacheDir)).toThrow("unrecoverable error");
});
