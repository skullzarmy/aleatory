/**
 * No hook runs conditionally, in any client component.
 *
 * A hook after an early return, or inside a branch, runs on some renders and
 * not others, so React loses track of which state belongs to which call. It
 * reports that at runtime, in a browser, and only on the path that branches.
 *
 * Parsed with TypeScript's own parser: indentation says nothing about scope,
 * and a nested component has its own hook order.
 *
 * Run: npx tsx src/lib/hooks.test.ts
 */
import ts from "typescript";
import { globSync, readFileSync } from "node:fs";

const HOOK = /^use[A-Z]/;
type Finding = { file: string; line: number; hook: string; why: string };
const found: Finding[] = [];

for (const file of globSync("src/**/*.tsx")) {
    const src = readFileSync(file, "utf8");
    if (!src.startsWith('"use client"')) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    /** Walk a component body tracking whether we are past a return, or inside a branch. */
    function walkBody(body: ts.Node, file: string) {
        let returned = false;
        const visit = (n: ts.Node, conditional: boolean) => {
            // A nested function has its own hook scope.
            if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))
                return;

            if (ts.isCallExpression(n)) {
                const name = ts.isIdentifier(n.expression)
                    ? n.expression.text
                    : ts.isPropertyAccessExpression(n.expression) &&
                        ts.isIdentifier(n.expression.name)
                      ? n.expression.name.text
                      : "";
                if (HOOK.test(name)) {
                    const why = returned
                        ? "after an early return"
                        : conditional
                          ? "inside a branch"
                          : "";
                    if (why) {
                        const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
                        found.push({
                            file: file.replace("src/", ""),
                            line: line + 1,
                            hook: name,
                            why,
                        });
                    }
                }
            }
            if (ts.isReturnStatement(n) && !conditional) returned = true;
            // A return inside a branch still ends that path, and hooks after
            // the branch are fine, so only unconditional returns latch.
            if (ts.isIfStatement(n) || ts.isConditionalExpression(n) || ts.isSwitchStatement(n)) {
                if (ts.isIfStatement(n)) {
                    visit(n.expression, conditional);
                    n.thenStatement.forEachChild((c) => visit(c, true));
                    n.elseStatement?.forEachChild((c) => visit(c, true));
                    // `if (x) return …` at the top level of a component body
                    // makes everything after it conditional.
                    const t = n.thenStatement;
                    const bails =
                        ts.isReturnStatement(t) ||
                        (ts.isBlock(t) && t.statements.some((st) => ts.isReturnStatement(st)));
                    if (bails && !conditional) returned = true;
                    return;
                }
                n.forEachChild((c) => visit(c, true));
                return;
            }
            n.forEachChild((c) => visit(c, conditional));
        };
        body.forEachChild((c) => visit(c, false));
    }

    const isComponent = (name: string) => /^[A-Z]/.test(name);
    sf.forEachChild(function top(n) {
        if (ts.isFunctionDeclaration(n) && n.name && isComponent(n.name.text) && n.body)
            walkBody(n.body, file);
        if (ts.isVariableStatement(n))
            for (const d of n.declarationList.declarations)
                if (
                    ts.isIdentifier(d.name) &&
                    isComponent(d.name.text) &&
                    d.initializer &&
                    (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) &&
                    d.initializer.body &&
                    ts.isBlock(d.initializer.body)
                )
                    walkBody(d.initializer.body, file);
        n.forEachChild(top);
    });
}

if (found.length === 0) console.log("  every hook runs unconditionally, in every client component");
for (const f of found)
    console.log(`  ${f.why.toUpperCase().padEnd(20)} ${f.file}:${f.line}  ${f.hook}`);
process.exit(found.length ? 1 : 0);
