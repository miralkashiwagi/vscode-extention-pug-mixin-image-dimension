import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import { imageSize } from "image-size";

export type ImageSize = { width: number; height: number };

const UNSUPPORTED_EXT = new Set([".avif"]); // 安定優先：まずは未対応扱い

export async function resolveAndGetSize(file: string): Promise<ImageSize> {
  const cfg = vscode.workspace.getConfiguration("PugMixinImageDimension");
  const imagesRootRel = cfg.get<string>("imagesRoot", "app/assets/images");
  const globFallback = true;

  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error("workspace が開かれていません");

  const imagesRootAbs = path.join(ws.uri.fsPath, imagesRootRel);
  const direct = path.join(imagesRootAbs, file);

  let absPath: string | null = null;

  if (await exists(direct)) {
    absPath = direct;
  } else if (globFallback) {
    const matches = await fg([`**/${file}`], {
      cwd: ws.uri.fsPath,
      dot: false,
      onlyFiles: true,
      unique: true
    });

    if (matches.length === 1) {
      absPath = path.join(ws.uri.fsPath, matches[0]);
    } else if (matches.length > 1) {
      const pick = await vscode.window.showQuickPick(
        matches.map(m => ({ label: m })),
        { placeHolder: `同名ファイルが複数あります：${file}` }
      );
      if (pick) absPath = path.join(ws.uri.fsPath, pick.label);
    }
  }

  if (!absPath) throw new Error(`画像が見つかりません: ${file}`);

  const ext = path.extname(absPath).toLowerCase();

  if (UNSUPPORTED_EXT.has(ext)) {
    throw new Error(`この拡張機能では ${ext} のサイズ取得は未対応です（安定優先モード）: ${file}`);
  }

  if (ext === ".svg") {
    const svg = await fs.readFile(absPath, "utf8");
    const size = parseSvgSize(svg);
    if (!size) {
      throw new Error(`SVGサイズが取得できません（width/height または viewBox が必要です）: ${file}`);
    }
    return size;
  }

  // raster (jpg/png/gif/webp etc.)
  const buf = await fs.readFile(absPath);
  const dim = imageSize(buf);

  if (!dim.width || !dim.height) {
    throw new Error(`サイズ取得に失敗しました: ${file}`);
  }
  return { width: dim.width, height: dim.height };
}

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function parseSvgSize(svgText: string): ImageSize | null {
  const w = pickAttr(svgText, "width");
  const h = pickAttr(svgText, "height");
  const wNum = w ? parsePxNumber(w) : null;
  const hNum = h ? parsePxNumber(h) : null;
  if (wNum && hNum) return { width: wNum, height: hNum };

  const vb = pickAttr(svgText, "viewBox");
  if (vb) {
    const parts = vb.trim().split(/\s+|,/).map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      const vw = Math.round(parts[2]);
      const vh = Math.round(parts[3]);
      if (vw > 0 && vh > 0) return { width: vw, height: vh };
    }
  }
  return null;
}

function pickAttr(svg: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = svg.match(re);
  return m?.[1] ?? null;
}

function parsePxNumber(v: string): number | null {
  // "100" "100px" はOK、"100%" は未対応（null）
  const m = v.trim().match(/^([0-9]+(?:\.[0-9]+)?)(px)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.round(n) : null;
}
