import { parse } from "acorn";

type AnyNode = any;

export type ImgArgs = {
  file: string;
  altIndex: number | null;
  widthIndex: number | null;
  heightIndex: number | null;
  argsCount: number;
};

export type PictureOpts = {
  pc?: string;
  sp?: string;
  hasWidth?: boolean;
  hasHeight?: boolean;
  hasWidthSp?: boolean;
  hasHeightSp?: boolean;
  objStart: number; // argsText 内オフセット
  objEnd: number;   // argsText 内オフセット
};

// ---- dataArray multi-source types ----
export type DataSourceSpec = { imageKey: string; widthKey: string; heightKey: string };

export type CardsDataSourceFound = {
  image: string;
  widthKey: string;
  heightKey: string;
  hasWidth: boolean;
  hasHeight: boolean;
};

export type CardsDataItem = {
  objStart: number; // argsText 内オフセット
  objEnd: number;   // argsText 内オフセット
  sources: CardsDataSourceFound[];
};

export type CardsData = {
  kind: "array" | "object";
  items: CardsDataItem[];
};

export function parseImgArgs(argsText: string): { ok: true; data: ImgArgs } | { ok: false; reason: string } {
  const ast = parseAsCallArgs(argsText);
  if (!ast) return { ok: false, reason: "引数の解析に失敗しました（JSとして解釈できません）" };

  const args: AnyNode[] = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数（file）がありません" };

  if (args[0].type !== "Literal" || typeof args[0].value !== "string") {
    return { ok: false, reason: "file が文字列リテラルではありません（変数/式は未対応）" };
  }

  return {
    ok: true,
    data: {
      file: args[0].value,
      altIndex: args.length >= 2 ? 1 : null,
      widthIndex: args.length >= 3 ? 2 : null,
      heightIndex: args.length >= 4 ? 3 : null,
      argsCount: args.length
    }
  };
}

export function parsePictureOpts(argsText: string): { ok: true; data: PictureOpts } | { ok: false; reason: string } {
  const ast = parseAsCallArgs(argsText);
  if (!ast) return { ok: false, reason: "引数の解析に失敗しました（JSとして解釈できません）" };

  const args: AnyNode[] = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数（opts）がありません" };

  const obj = args[0];
  if (obj.type !== "ObjectExpression") {
    return { ok: false, reason: "picture は optsオブジェクト形式のみ対応です（第1引数がObjectではありません）" };
  }

  const out: PictureOpts = { objStart: obj.start, objEnd: obj.end };

  for (const p of obj.properties ?? []) {
    const key = p.key?.name ?? p.key?.value;
    if (!key) continue;

    if (key === "pc" || key === "sp") {
      if (p.value?.type === "Literal" && typeof p.value.value === "string") {
        (out as any)[key] = p.value.value;
      }
    }

    if (key === "width") out.hasWidth = true;
    if (key === "height") out.hasHeight = true;
    if (key === "widthSp") out.hasWidthSp = true;
    if (key === "heightSp") out.hasHeightSp = true;
  }

  return { ok: true, data: out };
}

/**
 * dataArray multi-source:
 * +c_cards([ { imagePc:"a.jpg", imageSp:"b.jpg" }, ... ])
 * +c_cards({ imagePc:"a.jpg", imageSp:"b.jpg" })
 *
 * - 変数参照や式は未対応（スキップ）
 * - specs で pc/sp など複数画像を定義
 */
export function parseCardsData(
  argsText: string,
  specs: DataSourceSpec[]
): { ok: true; data: CardsData } | { ok: false; reason: string } {
  const ast = parseAsCallArgs(argsText);
  if (!ast) return { ok: false, reason: "引数の解析に失敗しました（JSとして解釈できません）" };

  const args: AnyNode[] = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数がありません" };

  const first = args[0];

  if (first.type === "ArrayExpression") {
    const items: CardsDataItem[] = [];
    for (const el of first.elements ?? []) {
      if (!el || el.type !== "ObjectExpression") continue;
      const item = readSourcesFromObject(el, specs);
      if (item) items.push(item);
    }
    if (items.length === 0) {
      return { ok: false, reason: "配列内に処理できる要素がありません（画像キーが文字列リテラルの要素のみ対応）" };
    }
    return { ok: true, data: { kind: "array", items } };
  }

  if (first.type === "ObjectExpression") {
    const item = readSourcesFromObject(first, specs);
    if (!item) return { ok: false, reason: "処理できる画像キーがありません（変数/式は未対応）" };
    return { ok: true, data: { kind: "object", items: [item] } };
  }

  return { ok: false, reason: "第1引数が配列/オブジェクトではありません（変数参照は未対応）" };
}

function readSourcesFromObject(obj: AnyNode, specs: DataSourceSpec[]): CardsDataItem | null {
  const props = new Map<string, AnyNode>();
  for (const p of obj.properties ?? []) {
    const key = p.key?.name ?? p.key?.value;
    if (!key) continue;
    props.set(String(key), p.value);
  }

  const sources: CardsDataSourceFound[] = [];

  for (const spec of specs) {
    const v = props.get(spec.imageKey);
    if (v?.type !== "Literal" || typeof v.value !== "string") continue;

    const image = v.value;

    sources.push({
      image,
      widthKey: spec.widthKey,
      heightKey: spec.heightKey,
      hasWidth: props.has(spec.widthKey),
      hasHeight: props.has(spec.heightKey)
    });
  }

  if (sources.length === 0) return null;

  // ★重要：acorn start/end は `f(${argsText})` 基準なので "f(" の2文字を引く
  const objStart = Math.max(0, (obj.start ?? 0) - 2);
  const objEnd = Math.max(objStart, (obj.end ?? 0) - 2);

  return { objStart, objEnd, sources };
}

/**
 * argsText を JS の CallExpression 引数として parse して返す。
 * `f(${argsText})` の形で parse し、args の start/end を argsText 起点に補正する。
 */
function parseAsCallArgs(argsText: string): { args: AnyNode[] } | null {
  try {
    const program = parse(`f(${argsText})`, {
      ecmaVersion: "latest",
      sourceType: "script",
      ranges: true
    }) as AnyNode;

    const expr = program.body?.[0]?.expression;
    const call = expr && expr.type === "CallExpression" ? expr : null;
    if (!call) return null;

    const args = (call.arguments ?? []).map((n: AnyNode) => ({
      ...n,
      start: n.start - 2, // "f(" の2文字分
      end: n.end - 2
    }));

    return { args };
  } catch {
    return null;
  }
}
