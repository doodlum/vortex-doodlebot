const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function runnableExamples(root) {
  const walk = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(filename) : [filename];
    });
  const examples = [];
  for (const filename of walk(path.join(root, "docs")).filter((file) => file.endsWith(".md"))) {
    const body = fs.readFileSync(filename, "utf8");
    for (const match of body.matchAll(
      /```typescript title="([a-zA-Z0-9_./-]+\.(?:mts|ts))"\r?\n([\s\S]*?)\r?\n```/g,
    )) {
      examples.push({
        file: path.relative(root, filename).replaceAll("\\", "/"),
        title: match[1],
        code: match[2],
      });
    }
  }
  return examples;
}

function extractExample(root, file, title) {
  const body = fs.readFileSync(path.join(root, file), "utf8");
  const fence = '```typescript title="' + title + '"';
  const start = body.indexOf(fence);
  if (start === -1) throw new Error(`${file}: missing runnable example ${title}`);
  const end = body.indexOf("```", start + fence.length);
  if (end === -1) throw new Error(`${file}: unclosed runnable example ${title}`);
  return body.slice(start + fence.length, end).trim() + "\n";
}

function checkExamples(root, replacements = {}) {
  const config = ts.readConfigFile(path.join(root, "harness/tsconfig.json"), ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, "harness"));
  const examples = runnableExamples(root);
  if (examples.length === 0) return ["Human documentation has no runnable TypeScript examples."];
  const titles = new Set();
  for (const example of examples) {
    if (example.title.split("/").some((part) => part === ".." || !part))
      return [`Runnable TypeScript filenames must stay inside the repository: ${example.title}`];
    if (titles.has(example.title))
      return [
        `Duplicate runnable TypeScript filename ${example.title}; use unique filenames so every example is checked.`,
      ];
    titles.add(example.title);
  }
  const files = new Map(
    examples.map(({ file, title, code }) => {
      let body = replacements[file] ?? code;
      // The dynamic kit URL is supplied at runtime. Give its actual module type to the
      // compiler so a typo cannot pass merely because a dynamic import has type any.
      body = body.replace(
        "const kit = await import(process.env.VORTEX_AI_KIT!);",
        'const kit: typeof import("./harness/src/kit") = await import(process.env.VORTEX_AI_KIT!);',
      );
      return [path.normalize(path.join(root, title)), body];
    }),
  );
  const host = ts.createCompilerHost(parsed.options);
  const originalRead = host.readFile;
  const originalExists = host.fileExists;
  host.readFile = (file) => files.get(path.normalize(file)) ?? originalRead(file);
  host.fileExists = (file) => files.has(path.normalize(file)) || originalExists(file);
  const program = ts.createProgram([...files.keys()], parsed.options, host);
  const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file
      ? `${path.relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: `
      : "";
    return where + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  });
  const toolReference = fs.readFileSync(path.join(root, "docs/reference/mcp-tools.md"), "utf8");
  const schemas = new Map(
    [
      ...toolReference.matchAll(
        /^## (\w+)\r?\n[\s\S]*?```json title="Input schema"\r?\n([\s\S]*?)\r?\n```/gm,
      ),
    ].map((match) => [match[1], JSON.parse(match[2])]),
  );
  for (const file of files.keys()) {
    const source = program.getSourceFile(file);
    const inspect = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["call", "callRaw"].includes(node.expression.name.text) &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const name = node.arguments[0].text;
        const schema = schemas.get(name);
        if (!schema) errors.push(`${file}: unknown MCP tool ${name}`);
        else {
          const args = node.arguments[1];
          const keys =
            args && ts.isObjectLiteralExpression(args)
              ? args.properties
                  .filter((property) => property.name)
                  .map((property) =>
                    ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
                      ? property.name.text
                      : property.name.getText(source),
                  )
              : [];
          for (const key of keys)
            if (!Object.hasOwn(schema.properties ?? {}, key))
              errors.push(`${file}: ${name} does not accept ${key}`);
          for (const key of schema.required ?? [])
            if ((!args || ts.isObjectLiteralExpression(args)) && !keys.includes(key))
              errors.push(`${file}: ${name} requires ${key}`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  return errors;
}

module.exports = { runnableExamples, extractExample, checkExamples };
