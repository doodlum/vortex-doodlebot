const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const examples = [
  ["docs/testing/unit.md", "Runnable snapshot test", "harness/src/docs-example.test.ts"],
  [
    "docs/testing/integration.md",
    "Runnable deployment test",
    "harness/src/tests/docs-example.spec.ts",
  ],
  ["docs/guides/scripting.md", "Runnable inspection script", "harness/src/docs-inspect.mts"],
  ["docs/testing/benchmarks.md", "Runnable profiling script", "harness/src/docs-profile.mts"],
];

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
  const files = new Map(
    examples.map(([file, title, target]) => {
      let body = replacements[file] ?? extractExample(root, file, title);
      // The dynamic kit URL is supplied at runtime. Give its actual module type to the
      // compiler so a typo cannot pass merely because a dynamic import has type any.
      body = body.replace(
        "const kit = await import(process.env.VORTEX_AI_KIT!);",
        'const kit: typeof import("./kit") = await import(process.env.VORTEX_AI_KIT!);',
      );
      return [path.normalize(path.join(root, target)), body];
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

module.exports = { examples, extractExample, checkExamples };
