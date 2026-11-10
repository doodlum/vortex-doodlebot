/**
 * Every `doodlebot` command, in one list. `cli.ts` dispatches each entry without `handledBy`;
 * `bin/doodlebot.cjs` handles the `handledBy: "bin"` ones itself, before tsx loads.
 * `commands.test.ts` keeps this list and both dispatchers equal, and the plugin skills may name
 * only these commands (and their sub-commands).
 */
export interface CommandEntry {
  name: string;
  subcommands?: string[];
  handledBy?: "bin";
}

export const commands: CommandEntry[] = [
  // Instance lifecycle and setup
  { name: "setup" },
  { name: "auth-status" },
  { name: "save-login" },
  { name: "login-import" },
  { name: "doctor" },
  { name: "up" },
  { name: "bootstrap" },
  { name: "down" },
  { name: "status" },
  { name: "source" },
  { name: "build" },
  { name: "build-extension" },
  { name: "watch" },
  // The companion itself
  { name: "version" },
  { name: "link" },
  { name: "update", handledBy: "bin" },
  // Driving a running instance
  { name: "tools" },
  { name: "call" },
  { name: "snapshot" },
  { name: "click" },
  { name: "fill" },
  { name: "press" },
  { name: "screenshot" },
  { name: "eval" },
  { name: "script" },
  { name: "record" },
  { name: "install" },
  { name: "slow-download" },
  { name: "collection" },
  { name: "deploy" },
  { name: "purge" },
  { name: "e2e" },
  { name: "log" },
  { name: "fixture", subcommands: ["mod"] },
  { name: "knowledge", subcommands: ["add", "search", "list", "remove", "path"] },
  // Content the kit may write to
  { name: "game", subcommands: ["copy", "register", "restore"] },
  { name: "release", subcommands: ["get", "list"] },
  // Checks and evidence
  { name: "test" },
  { name: "responsive" },
  { name: "perf-summary" },
  { name: "evidence", subcommands: ["identity", "run", "runtime"] },
  { name: "pr-checks" },
  { name: "pr-preflight" },
  { name: "vortex-e2e" },
];

export function findCommand(name: string): CommandEntry | undefined {
  return commands.find((command) => command.name === name);
}
