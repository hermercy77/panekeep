import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const ROOT = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("localization guardrail", () => {
  it("keeps Simplified Chinese user copy inside the shared catalog", () => {
    const violations = sourceFiles(ROOT)
      .filter((path) => !path.endsWith(join("i18n", "catalog.ts")))
      .flatMap((path) => readFileSync(path, "utf8").split(/\r?\n/).flatMap((line, index) =>
        /[\u3400-\u9fff]/u.test(line) ? [`${relative(process.cwd(), path)}:${index + 1}`] : []
      ));
    expect(violations, "Put all user-facing copy in src/i18n/catalog.ts and add every locale at the same time.").toEqual([]);
  });

  it("rejects new hard-coded English JSX copy outside the catalog", () => {
    const allowed = new Set(["Tab Fridge", "Base URL", "API Key"]);
    const violations: string[] = [];
    for (const path of sourceFiles(join(ROOT, "ui")).filter((file) => file.endsWith(".tsx"))) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
          const copy = node.getText(source).trim().replace(/\s+/g, " ");
          if (/[A-Za-z]/.test(copy) && !allowed.has(copy)) violations.push(`${relative(process.cwd(), path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}:${copy}`);
        }
        if (ts.isJsxAttribute(node) && ["aria-label", "placeholder", "title"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
          violations.push(`${relative(process.cwd(), path)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}:${node.initializer.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations, "Use useI18n().t(...) for every new UI string and add all locales together.").toEqual([]);
  });
});
