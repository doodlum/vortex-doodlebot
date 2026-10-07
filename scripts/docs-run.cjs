const { spawn } = require("node:child_process");
const path = require("node:path");
const mode = process.argv[2];
if (!["build", "serve"].includes(mode)) throw new Error("Use build or serve.");
const args = [
  "-m",
  "mkdocs",
  mode,
  ...(mode === "build" ? ["--strict"] : []),
  ...process.argv.slice(3),
];
const child = spawn(process.env.DOODLEBOT_DOCS_PYTHON ?? "python", args, {
  cwd: path.resolve(__dirname, ".."),
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(
    "Documentation needs Python and requirements-docs.txt. See docs/maintaining-documentation.md. " +
      error.message,
  );
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
