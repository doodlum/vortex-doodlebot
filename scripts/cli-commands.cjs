// The commands a dispatcher handles, read from its source with the TypeScript AST: every
// `command === "<x>"` comparison, and every `case "<x>":` label whose nearest enclosing
// `switch` is `switch (command)`. A nested switch on something else (cli.ts's watch events)
// is therefore not counted. Shared by scripts/docs.cjs and harness/src/commands.test.ts.
const fs = require("node:fs");
const ts = require("typescript");

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

/** The sorted, distinct command names `sourceFile` dispatches (a ts.SourceFile). */
function dispatchedCommands(sourceFile) {
  const names = new Set();
  visit(sourceFile, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      node.left.getText(sourceFile) === "command" &&
      ts.isStringLiteral(node.right)
    )
      names.add(node.right.text);
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
      let parent = node.parent;
      while (parent && !ts.isSwitchStatement(parent)) parent = parent.parent;
      if (parent?.expression.getText(sourceFile) === "command") names.add(node.expression.text);
    }
  });
  return [...names].sort();
}

/** `dispatchedCommands` of a file on disk (TypeScript or JavaScript). */
function dispatchedCommandsInFile(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return dispatchedCommands(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
}

module.exports = { dispatchedCommands, dispatchedCommandsInFile };
