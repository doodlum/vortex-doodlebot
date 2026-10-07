import { defineConfig } from "@playwright/test";
import core from "./playwright.config";

export default defineConfig({ ...core, testMatch: "**/oauth-restore.spec.ts", testIgnore: [] });
