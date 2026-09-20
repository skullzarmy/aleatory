/**
 * No hook runs conditionally, in any client component. A hook after an early
 * return, or inside a branch, runs on some renders and not others, and React
 * reports it at runtime, in a browser, only on the path that branches.
 *
 * Parsed with TypeScript's own parser: indentation says nothing about scope,
 * and a nested component has its own hook order.
 *
 * TypeScript 7 is the native compiler and its default export is the version
 * string. The parser did not go away, it moved behind `typescript/unstable`,
 * and it is reached through a project rather than by parsing a file on its own:
 * open the tsconfig, ask the program for the file. The node guards and
 * `forEachChild` are the same as they ever were.
 *
 * `unstable` is the word in the path and it is meant: these entry points can
 * move. When they do, this file is where it hurts, and the check it performs is
 * worth that.
 *
 * Run: npx tsx src/lib/hooks.test.ts
 */
import { API } from "typescript/unstable/sync";
import * as is from "typescript/unstable/ast/is";
import type { Node } from "typescript/unstable/ast";
import { globSync, readFileSync } from "node:fs";

const HOOK = /^use[A-Z]/;
type Finding = { file: string; line: number; hook: string; why: string };
const found: Finding[] = [];

const api = new API({ cwd: process.cwd() });
const snapshot = api.updateSnapshot({ openProjects: ["tsconfig.json"] });
const program = snapshot.getProjects()[0]?.program;
if (!program) throw new Error("tsconfig.json opened no project, so nothing was checked.");

for (const file of globSync("src/**/*.tsx")) {
    const src = readFileSync(file, "utf8");
    if (!src.startsWith('"use client"')) continue;
    const sf = program.getSourceFile(file);
    // A client component the program does not hold is one this never looked
    // at, which is a silent pass and the thing this file exists to prevent.
    if (!sf) throw new Error(`${file} is not in the program, so it went unchecked.`);

    // Bound here rather than reached for inside the walk: `walkBody` is hoisted,
    // so the narrowing above does not follow `sf` into it.
    const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

    /** Walk a component body tracking whether we are past a return, or inside a branch. */
    function walkBody(body: Node, file: string) {
        let returned = false;
        const visit = (n: Node, conditional: boolean) => {
            // A nested function has its own hook scope.
            if (is.isFunctionDeclaration(n) || is.isFunctionExpression(n) || is.isArrowFunction(n))
                return;

            if (is.isCallExpression(n)) {
                const name = is.isIdentifier(n.expression)
                    ? n.expression.text
                    : is.isPropertyAccessExpression(n.expression) &&
                        is.isIdentifier(n.expression.name)
                      ? n.expression.name.text
                      : "";
                if (HOOK.test(name)) {
                    const why = returned
                        ? "after an early return"
                        : conditional
                          ? "inside a branch"
                          : "";
                    if (why) {
                        found.push({
                            file: file.replace("src/", ""),
                            line: lineOf(n.getStart()),
                            hook: name,
                            why,
                        });
                    }
                }
            }
            if (is.isReturnStatement(n) && !conditional) returned = true;
            // A return inside a branch still ends that path, and hooks after
            // the branch are fine, so only unconditional returns latch.
            if (is.isIfStatement(n) || is.isConditionalExpression(n) || is.isSwitchStatement(n)) {
                if (is.isIfStatement(n)) {
                    visit(n.expression, conditional);
                    n.thenStatement.forEachChild((c) => visit(c, true));
                    n.elseStatement?.forEachChild((c) => visit(c, true));
                    // `if (x) return …` at the top level of a component body
                    // makes everything after it conditional.
                    const t = n.thenStatement;
                    const bails =
                        is.isReturnStatement(t) ||
                        (is.isBlock(t) && t.statements.some((st) => is.isReturnStatement(st)));
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
        if (is.isFunctionDeclaration(n) && n.name && isComponent(n.name.text) && n.body)
            walkBody(n.body, file);
        if (is.isVariableStatement(n))
            for (const d of n.declarationList.declarations)
                if (
                    is.isIdentifier(d.name) &&
                    isComponent(d.name.text) &&
                    d.initializer &&
                    (is.isArrowFunction(d.initializer) || is.isFunctionExpression(d.initializer)) &&
                    d.initializer.body &&
                    is.isBlock(d.initializer.body)
                )
                    walkBody(d.initializer.body, file);
        n.forEachChild(top);
    });
}

api.close();

if (found.length === 0) console.log("  every hook runs unconditionally, in every client component");
for (const f of found)
    console.log(`  ${f.why.toUpperCase().padEnd(20)} ${f.file}:${f.line}  ${f.hook}`);
process.exit(found.length ? 1 : 0);
