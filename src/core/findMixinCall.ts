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
  const rules = getTargetRules();
  const names = Array.from(new Set(rules.map(r => r.name)));

  // 現在の行から上に向かって探索
  for (let line = pos.line; line >= 0; line--) {
    const text = doc.lineAt(line).text;

// その行にある全てのターゲット候補を抽出 (+name を探す)
    const hits: { name: string; idx: number }[] = [];
    for (const name of names) {
      const needle = `+${name}`;
      let lastIdx = -1;
      while ((lastIdx = text.indexOf(needle, lastIdx + 1)) >= 0) {
        // ★ ここで ( の有無を判定しない。候補として追加する
        hits.push({ name, idx: lastIdx });
      }
    }

    if (hits.length === 0) continue;

    // 出現順（左から右）にソート
    hits.sort((a, b) => a.idx - b.idx);

    // 各ヒットについて、その範囲がカーソル位置をカバーしているか確認
    for (const hit of hits) {
      const start = new vscode.Position(line, hit.idx);
      const { end, callText } = readUntilBalancedParen(doc, start);
      if (!end) continue;

      const range = new vscode.Range(start, end);

      // カーソル位置がこの mixin 呼び出しの範囲内にあるかチェック
      // 閉じカッコの直後も許容する（ユーザーがカッコの末尾にカーソルを置くことが多いため）
      if (range.contains(pos) || range.end.isEqual(pos)) {
        const openParen = callText.indexOf("(");
        const closeParen = callText.lastIndexOf(")");
        if (openParen < 0 || closeParen < 0 || closeParen <= openParen) continue;

        return {
          name: hit.name,
          range,
          callText,
          argsText: callText.slice(openParen + 1, closeParen),
          argsStartOffsetInCall: openParen + 1
        };
      }
    }
  }

  return null;
}

// buildTargetsFromRules は不要になったので削除

// readUntilBalancedParen を修正
function readUntilBalancedParen(
  doc: vscode.TextDocument,
  start: vscode.Position
): { end: vscode.Position | null; callText: string } {
  let text = "";
  let paren = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let escaped = false;
  let foundOpenParen = false;

  for (let line = start.line; line < doc.lineCount; line++) {
    const lineText = doc.lineAt(line).text;
    const fromCh = line === start.line ? start.character : 0;
    const chunk = lineText.slice(fromCh);
    
    let currentLineProcessedText = "";

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      currentLineProcessedText += c;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inStr) {
        if (c === "\\") {
          escaped = true;
          continue;
        }
        if (c === inStr) {
          inStr = null;
          continue;
        }
        continue;
      }

      // 文字列外
      if (c === "'" || c === '"' || c === "`") {
        inStr = c;
        continue;
      }

      // コメントチェック (//)
      if (c === "/" && chunk[i + 1] === "/") {
        // その行の残りは無視
        break;
      }

      if (c === "(") {
        paren++;
        foundOpenParen = true;
      }
      if (c === ")") {
        paren--;
      }

      if (foundOpenParen && paren <= 0) {
        // バランスした！
        const fullTextUntilNow = text + (line === start.line ? "" : "\n") + currentLineProcessedText;
        const endChar = (line === start.line ? start.character : 0) + i + 1;
        return {
          end: new vscode.Position(line, endChar),
          callText: fullTextUntilNow
        };
      }
    }

    text += (line === start.line ? "" : "\n") + chunk;
  }

  return { end: null, callText: text };
}
