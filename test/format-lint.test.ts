import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// Phase 1 (docs/metrics-audit.md): every figure on screen goes through src/lib/format.ts.
// This check fails the build when a page or component formats a number itself:
//   · `.toFixed(` or `.toLocaleString(` anywhere in a UI file
//   · `Math.round / ceil / floor`, or a `/` or `*` calculation, interpolated straight into JSX text
//     (a JSX child expression, or a template literal inside one) — that is a raw float on screen
//   · a JSX child expression followed by a literal "%" — a share rendered by hand
// Attributes (`title=` for the unrounded hover, `style=` for bar widths, `value=` for inputs) are
// not screen text and are left alone; so is arithmetic inside a call (fmt.pct(a / b) is fine).

const ROOT = join(__dirname, "..");
const UI_DIRS = ["src/components", "src/app"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ROUNDERS = new Set(["round", "ceil", "floor", "trunc"]);

/** Is this expression tree a hand-made display figure? Stops at call boundaries other than Math.* — a
 *  formatter call (fmt.pct(a / b), n0(x), dec(y)) owns whatever arithmetic sits inside it. */
function rawFigure(node: ts.Node): string | null {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Math" && ROUNDERS.has(callee.name.text)) return `Math.${callee.name.text}(…)`;
    return null; // some other call — its result is the caller's responsibility (fmt.*, dec, n0, …)
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return null; // an inline component / callback, not a figure
  if (ts.isJsxAttributes(node)) return null; // title= / style= / value= are not screen text
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return null; // nested markup: its own children are checked on their own
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.SlashToken || op === ts.SyntaxKind.AsteriskToken) return `${node.getText().slice(0, 60)}`;
  }
  let found: string | null = null;
  node.forEachChild((c) => { if (!found) found = rawFigure(c); });
  return found;
}

function lint(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const problems: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === "toFixed" || name === "toLocaleString") problems.push(`${rel}:${line(node)} .${name}() — use fmt.* from src/lib/format`);
    }
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const raw = rawFigure(node.expression);
      if (raw) problems.push(`${rel}:${line(node)} raw figure in JSX text: ${raw}`);
      // {share}% — a percentage assembled by hand
      const kids = node.parent.children;
      const i = kids.indexOf(node as ts.JsxChild);
      const next = kids[i + 1];
      if (next && ts.isJsxText(next) && next.text.trimStart().startsWith("%")) problems.push(`${rel}:${line(node)} "{…}%" — use fmt.pct`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

describe("numbers on screen go through the format module (Phase 1)", () => {
  const files = UI_DIRS.flatMap((d) => tsxFiles(join(ROOT, d)));
  it("scans the UI", () => { expect(files.length).toBeGreaterThan(50); });
  it("finds no hand-formatted figure in a page or component", () => {
    const problems = files.flatMap(lint);
    expect(problems, problems.join("\n")).toEqual([]);
  });
  it("catches the patterns it is meant to catch", () => {
    const tmp = join(__dirname, "__fixture__.tsx");
    const src = `export const X = ({ a, b }: { a: number; b: number }) => <div>{Math.round(a * 100)}<span>{a / b}</span>{a.toFixed(1)}{b}% <i title={\`\${a / b}\`} style={{ width: \`\${a * 100}%\` }}>{fmt.pct(a / b)}</i></div>;`;
    const sf = ts.createSourceFile(tmp, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) { const r = rawFigure(n.expression); if (r) found.push(r); }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "toFixed") found.push("toFixed");
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found).toEqual(["Math.round(…)", "a / b", "toFixed"]);
  });
});
