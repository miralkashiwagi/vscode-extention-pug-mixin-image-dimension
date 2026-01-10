// src/core/findMixinCall.ts
import * as vscode from "vscode";
import { getTargetRules } from "./rules";

export type FoundCall = {
  name: string; // 任意mixin名
  range: vscode.Range;
  callText: string;
  argsText: string;
  argsStartOffsetInCall: number;
};

type Target = { name: string; needle: string };

export function findMixinCallAtCursor(doc: vscode.TextDocument, pos: vscode.Position): FoundCall | null {
  const targets = buildTargetsFromRules();

  for (let line = pos.line; line >= 0; line--) {
    const text = doc.lineAt(line).text;

    const hit = targets
      .map(t => ({ t, idx: text.indexOf(t.needle) }))
      .filter(x => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx)[0];

    if (!hit) continue;

    const start = new vscode.Position(line, hit.idx);
    const { end, callText } = readUntilBalancedParen(doc, start);
    if (!end) return null;

    const openParen = callText.indexOf("(");
    const closeParen = callText.lastIndexOf(")");
    if (openParen < 0 || closeParen < 0 || closeParen <= openParen) return null;

    return {
      name: hit.t.name,
      range: new vscode.Range(start, end),
      callText,
      argsText: callText.slice(openParen + 1, closeParen),
      argsStartOffsetInCall: openParen + 1
    };
  }

  return null;
}

function buildTargetsFromRules(): Target[] {
  const rules = getTargetRules();
  // 同名が複数typeで登録されても、検出needleは同じなので name重複を潰す
  const names = Array.from(new Set(rules.map(r => r.name)));
  return names.map(name => ({ name, needle: `+${name}(` }));
}

// readUntilBalancedParen は既存のままでOK
function readUntilBalancedParen(
  doc: vscode.TextDocument,
  start: vscode.Position
): { end: vscode.Position | null; callText: string } {
  let text = "";
  let paren = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let line = start.line; line < doc.lineCount; line++) {
    const lineText = doc.lineAt(line).text;
    const fromCh = line === start.line ? start.character : 0;
    const chunk = lineText.slice(fromCh);
    text += (line === start.line ? "" : "\n") + chunk;

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];

      if (escaped) { escaped = false; continue; }
      if (inStr) {
        if (c === "\\") { escaped = true; continue; }
        if (c === inStr) { inStr = null; continue; }
        continue;
      } else {
        if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
        if (c === "(") paren++;
        if (c === ")") paren--;
      }
    }

    if (paren <= 0 && text.includes("(")) {
      return { end: new vscode.Position(line, lineText.length), callText: text };
    }
  }
  return { end: null, callText: text };
}
