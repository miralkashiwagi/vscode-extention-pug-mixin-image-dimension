import { parse, Node } from "acorn";

interface Literal extends Node {
  type: "Literal";
  value: string | number | boolean | null;
}

interface Property extends Node {
  type: "Property";
  key: Node & { name?: string; value?: string | number };
  value: Node;
}

interface ObjectExpression extends Node {
  type: "ObjectExpression";
  properties: Property[];
}

interface ArrayExpression extends Node {
  type: "ArrayExpression";
  elements: (Node | null)[];
}

interface CallExpression extends Node {
  type: "CallExpression";
  arguments: Node[];
}

interface Program extends Node {
  type: "Program";
  body: Array<Node & { expression?: Node }>;
}

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

  const args = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数（file）がありません" };

  const firstArg = args[0];
  if (firstArg.type !== "Literal") {
    return { ok: false, reason: "file が文字列リテラルではありません（変数/式は未対応）" };
  }

  const literal = firstArg as Literal;
  if (typeof literal.value !== "string") {
    return { ok: false, reason: "file が文字列リテラルではありません（変数/式は未対応）" };
  }

  return {
    ok: true,
    data: {
      file: literal.value,
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

  const args = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数（opts）がありません" };

  const firstArg = args[0];
  if (firstArg.type !== "ObjectExpression") {
    return { ok: false, reason: "picture は optsオブジェクト形式のみ対応です（第1引数がObjectではありません）" };
  }

  const obj = firstArg as ObjectExpression;
  const out: PictureOpts = { objStart: obj.start ?? 0, objEnd: obj.end ?? 0 };

  for (const p of obj.properties) {
    const key = p.key?.name ?? p.key?.value;
    if (!key) continue;

    if (key === "pc" || key === "sp") {
      if (p.value.type === "Literal") {
        const literal = p.value as Literal;
        if (typeof literal.value === "string") {
          out[key] = literal.value;
        }
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

  const args = ast.args;
  if (args.length < 1) return { ok: false, reason: "第1引数がありません" };

  const first = args[0];

  if (first.type === "ArrayExpression") {
    const arrayExpr = first as ArrayExpression;
    const items: CardsDataItem[] = [];
    for (const el of arrayExpr.elements) {
      if (!el || el.type !== "ObjectExpression") continue;
      const item = readSourcesFromObject(el as ObjectExpression, specs);
      if (item) items.push(item);
    }
    if (items.length === 0) {
      return { ok: false, reason: "配列内に処理できる要素がありません（画像キーが文字列リテラルの要素のみ対応）" };
    }
    return { ok: true, data: { kind: "array", items } };
  }

  if (first.type === "ObjectExpression") {
    const item = readSourcesFromObject(first as ObjectExpression, specs);
    if (!item) return { ok: false, reason: "処理できる画像キーがありません（変数/式は未対応）" };
    return { ok: true, data: { kind: "object", items: [item] } };
  }

  return { ok: false, reason: "第1引数が配列/オブジェクトではありません（変数参照は未対応）" };
}

function readSourcesFromObject(obj: ObjectExpression, specs: DataSourceSpec[]): CardsDataItem | null {
  const props = new Map<string, Node>();
  for (const p of obj.properties) {
    const key = p.key?.name ?? p.key?.value;
    if (!key) continue;
    props.set(String(key), p.value);
  }

  const sources: CardsDataSourceFound[] = [];

  for (const spec of specs) {
    const v = props.get(spec.imageKey);
    if (!v || v.type !== "Literal") continue;

    const literal = v as Literal;
    if (typeof literal.value !== "string") continue;

    const image = literal.value;

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
function parseAsCallArgs(argsText: string): { args: Node[] } | null {
  try {
    const program = parse(`f(${argsText})`, {
      ecmaVersion: "latest",
      sourceType: "script"
    }) as Program;

    const expr = program.body[0]?.expression;
    if (!expr || expr.type !== "CallExpression") return null;

    const call = expr as CallExpression;
    const args = call.arguments.map((n) => ({
      ...n,
      start: (n.start ?? 0) - 2, // "f(" の2文字分
      end: (n.end ?? 0) - 2
    }));

    return { args };
  } catch {
    return null;
  }
}
