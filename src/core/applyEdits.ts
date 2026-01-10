import * as vscode from "vscode";
import { findMixinCallAtCursor } from "./findMixinCall";
import { getTargetRules, TargetRule } from "./rules";
import { parseImgArgs, parsePictureOpts, parseCardsData } from "./parseArgs";
import { resolveAndGetSize } from "./imageSize";

export async function runInsert(opts: { mode: "full" | "half" }) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const doc = editor.document;
  const pos = editor.selection.active;

  const found = findMixinCallAtCursor(doc, pos);
  if (!found) {
    vscode.window.showInformationMessage("対象の mixin 呼び出しが見つかりませんでした。");
    return;
  }

  const rules = getTargetRules();
  const rule = pickRule(rules, found.name);

  if (!rule) {
    vscode.window.showInformationMessage(`+${found.name}(...) は検出しましたが、targetRules にルールがありません。`);
    return;
  }

  const cfg = vscode.workspace.getConfiguration("PugMixinImageDimension");

  try {
    switch (rule.type) {
      case "imgArgs":
        await handleImgArgs(editor, found, opts.mode);
        return;

      case "pictureOpts":
        await handlePictureOpts(editor, found, opts.mode);
        return;

      case "dataArray":
        await handleDataArray(editor, found, opts.mode, rule);
        return;

      default:
        vscode.window.showInformationMessage(`+${found.name}(...) は検出しましたが、未対応の type です。`);
        return;
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(e?.message ?? String(e));
  }
}

function pickRule(rules: TargetRule[], name: string): TargetRule | null {
  // 同名が複数登録されるのを避ける前提。必要なら QuickPick に拡張可能。
  return rules.find(r => r.name === name) ?? null;
}

async function handleImgArgs(
  editor: vscode.TextEditor,
  found: { argsText: string } & any,
  mode: "full" | "half"
) {
  const parsed = parseImgArgs(found.argsText);
  if (!parsed.ok) throw new Error(parsed.reason);

  const size = await resolveAndGetSize(parsed.data.file);
  const scaled = scale(size.width, size.height, mode);

  const newArgsText = patchImgArgs(found.argsText, scaled.width, scaled.height);
  await replaceArgsText(editor, found, newArgsText);
}

async function handlePictureOpts(
  editor: vscode.TextEditor,
  found: { argsText: string } & any,
  mode: "full" | "half"
) {
  const parsed = parsePictureOpts(found.argsText);
  if (!parsed.ok) throw new Error(parsed.reason);

  const pc = parsed.data.pc;
  const sp = parsed.data.sp;

  if (!pc && !sp) {
    throw new Error("opts.pc / opts.sp が見つかりません（文字列リテラルのみ対応）");
  }

  const pcSize = pc ? await resolveAndGetSize(pc) : null;
  const spSize = sp ? await resolveAndGetSize(sp) : null;

  const pcScaled = pcSize ? scale(pcSize.width, pcSize.height, mode) : null;
  const spScaled = spSize ? scale(spSize.width, spSize.height, mode) : null;

  const newArgsText = patchPictureOpts(found.argsText, parsed.data, pcScaled, spScaled);
  await replaceArgsText(editor, found, newArgsText);
}

async function handleDataArray(
  editor: vscode.TextEditor,
  found: { argsText: string } & any,
  mode: "full" | "half",
  rule: Extract<TargetRule, { type: "dataArray" }>
) {
  const parsed = parseCardsData(found.argsText, rule.sources);
  if (!parsed.ok) throw new Error(parsed.reason);

  let newArgsText = found.argsText;

  // 後ろから置換するとオフセットがずれにくい
  const itemsSorted = [...parsed.data.items].sort((a, b) => b.objStart - a.objStart);

  for (const item of itemsSorted) {
    const objSrc = newArgsText.slice(item.objStart, item.objEnd);

    const propsToAdd: string[] = [];

    for (const s of item.sources) {
      const size = await resolveAndGetSize(s.image);
      const scaled = scale(size.width, size.height, mode);

      propsToAdd.push(`${s.widthKey}: ${scaled.width}`);
      propsToAdd.push(`${s.heightKey}: ${scaled.height}`);
    }

    if (propsToAdd.length === 0) continue;

    const newObj = insertPropsIntoObjectLiteral(objSrc, propsToAdd);
    newArgsText = newArgsText.slice(0, item.objStart) + newObj + newArgsText.slice(item.objEnd);
  }

  await replaceArgsText(editor, found, newArgsText);
}

function scale(w: number, h: number, mode: "full" | "half") {
  if (mode === "full") return { width: w, height: h };
  return { width: Math.round(w / 2), height: Math.round(h / 2) };
}

async function replaceArgsText(editor: vscode.TextEditor, found: any, newArgsText: string) {
  const callText = found.callText as string;
  const openParen = callText.indexOf("(");
  const closeParen = callText.lastIndexOf(")");
  const startOffset = openParen + 1;
  const endOffset = closeParen;

  const startPos = offsetToPosition(editor.document, found.range.start, callText, startOffset);
  const endPos = offsetToPosition(editor.document, found.range.start, callText, endOffset);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, new vscode.Range(startPos, endPos), newArgsText);
  await vscode.workspace.applyEdit(edit);
}

function offsetToPosition(doc: vscode.TextDocument, base: vscode.Position, callText: string, offset: number): vscode.Position {
  const before = callText.slice(0, offset);
  const lines = before.split("\n");
  const lineDelta = lines.length - 1;
  const char = lines[lines.length - 1].length;
  return new vscode.Position(base.line + lineDelta, (lineDelta === 0 ? base.character : 0) + char);
}

function patchImgArgs(argsText: string, width: number, height: number): string {
  const parts = splitTopLevelArgs(argsText);

  // +img(file, alt) の想定で、width/height が無ければ追記
  if (parts.length < 3) {
    return parts.concat([String(width), String(height)]).join(", ");
  }

  // width
  parts[2] = String(width);

  // height
  if (parts.length < 4) {
    return parts.concat([String(height)]).join(", ");
  }

  parts[3] = String(height);

  return parts.join(", ");
}

function patchPictureOpts(
  argsText: string,
  info: any,
  pc: { width: number; height: number } | null,
  sp: { width: number; height: number } | null
): string {
  const objSrc = argsText.slice(info.objStart, info.objEnd);

  const toAdd: string[] = [];

  if (pc) {
    toAdd.push(`width: ${pc.width}`);
    toAdd.push(`height: ${pc.height}`);
  }
  if (sp) {
    toAdd.push(`widthSp: ${sp.width}`);
    toAdd.push(`heightSp: ${sp.height}`);
  }

  if (toAdd.length === 0) return argsText;

  const newObj = insertPropsIntoObjectLiteral(objSrc, toAdd);
  return argsText.slice(0, info.objStart) + newObj + argsText.slice(info.objEnd);
}

/**
 * “ほどほどに” 整形を壊さずに ObjectLiteral にプロパティを追加または上書きするヒューリスティック。
 * - 既存のキーがある場合は上書き
 * - 存在しない場合は追加
 * - 単一行: `{ a: 1 }` → `{ a: 1, width: 100, height: 200 }`
 * - 複数行: `}` の直前にインデントして追加
 */
function insertPropsIntoObjectLiteral(objSrc: string, props: string[]): string {
  let result = objSrc;

  for (const p of props) {
    const colonIndex = p.indexOf(":");
    if (colonIndex === -1) continue;
    const key = p.slice(0, colonIndex).trim();
    const value = p.slice(colonIndex + 1).trim();

    // 既存のキーがあるか探す (単純な正規表現)
    // キー: 値 の形式を探す。値はカンマ、閉じ括弧、改行などの手前まで。
    const re = new RegExp(`(\\b${key}\\s*:\\s*)([^,} \n\r\t]+)`, "g");

    if (re.test(result)) {
      result = result.replace(re, `$1${value}`);
    } else {
      result = appendProp(result, p);
    }
  }

  return result;
}

function appendProp(objSrc: string, prop: string): string {
  const isMultiLine = objSrc.includes("\n");

  if (!isMultiLine) {
    const inner = objSrc.trim().replace(/^\{\s*/, "").replace(/\s*\}$/, "");
    const trimmedInner = inner.trim();
    if (trimmedInner === "") return `{ ${prop} }`;
    return `{ ${trimmedInner.replace(/,\s*$/, "")}, ${prop} }`;
  }

  const lines = objSrc.split("\n");
  const lastLine = lines[lines.length - 1];
  const indent = lastLine.match(/^\s*/)?.[0] ?? "";
  const insertIndent = indent + "  ";

  // `}` の直前の有効行にカンマを付ける（簡易）
  for (let i = lines.length - 2; i >= 0; i--) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (!t.endsWith(",") && !t.endsWith("{")) {
      lines[i] = lines[i] + ",";
    }
    break;
  }

  const insertLine = `${insertIndent}${prop},`;
  lines.splice(lines.length - 1, 0, insertLine);
  return lines.join("\n");
}

/**
 * argsText をトップレベルのカンマで分割（ネスト/文字列は無視）
 */
function splitTopLevelArgs(argsText: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depthParen = 0, depthBrace = 0, depthBrack = 0;
  let inStr: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];

    if (escaped) { cur += c; escaped = false; continue; }

    if (inStr) {
      cur += c;
      if (c === "\\") { escaped = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") { inStr = c; cur += c; continue; }

    if (c === "(") depthParen++;
    else if (c === ")") depthParen--;
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace--;
    else if (c === "[") depthBrack++;
    else if (c === "]") depthBrack--;

    if (c === "," && depthParen === 0 && depthBrace === 0 && depthBrack === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += c;
  }

  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}
