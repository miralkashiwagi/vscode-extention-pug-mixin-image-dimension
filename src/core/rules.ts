import * as vscode from "vscode";

export type RuleType = "imgArgs" | "pictureOpts" | "dataArray";

export type TargetRule =
  | {
      name: string;
      type: "imgArgs";
      altIndex?: number;
      widthIndex?: number;
      heightIndex?: number;
    }
  | {
      name: string;
      type: "pictureOpts";
      pcKey?: string;
      spKey?: string;
      pcWidthKey?: string;
      pcHeightKey?: string;
      spWidthKey?: string;
      spHeightKey?: string;
    }
  | {
      name: string;
      type: "dataArray";
      sources: Array<{
        imageKey: string;
        widthKey: string;
        heightKey: string;
      }>;
    };

export function getTargetRules(): TargetRule[] {
  const cfg = vscode.workspace.getConfiguration("PugMixinImageDimension");
  const raw = cfg.get<any[]>("targetRules", [
    { name: "img", type: "imgArgs" },
    { name: "picture", type: "pictureOpts" },
    {
      name: "c_cards",
      type: "dataArray",
      sources: [
        { imageKey: "image", widthKey: "width", heightKey: "height" },
        { imageKey: "imageSp", widthKey: "widthSp", heightKey: "heightSp" }
      ]
    }
  ]);

  const normalized: TargetRule[] = [];
  const seen = new Set<string>();

  for (const r of raw) {
    const name = normalizeName(String(r?.name ?? ""));
    const type = String(r?.type ?? "") as RuleType;
    if (!name || !type) continue;

    // 同名を複数登録したいケースは今回は未対応（必要なら QuickPick に拡張可能）
    const key = `${name}::${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === "imgArgs") {
      normalized.push({
        name,
        type,
        altIndex: typeof r.altIndex === "number" ? r.altIndex : undefined,
        widthIndex: typeof r.widthIndex === "number" ? r.widthIndex : undefined,
        heightIndex: typeof r.heightIndex === "number" ? r.heightIndex : undefined
      });
      continue;
    }

    if (type === "pictureOpts") {
      normalized.push({
        name,
        type,
        pcKey: typeof r.pcKey === "string" ? r.pcKey : undefined,
        spKey: typeof r.spKey === "string" ? r.spKey : undefined,
        pcWidthKey: typeof r.pcWidthKey === "string" ? r.pcWidthKey : undefined,
        pcHeightKey: typeof r.pcHeightKey === "string" ? r.pcHeightKey : undefined,
        spWidthKey: typeof r.spWidthKey === "string" ? r.spWidthKey : undefined,
        spHeightKey: typeof r.spHeightKey === "string" ? r.spHeightKey : undefined
      });
      continue;
    }

    if (type === "dataArray") {
      const sourcesRaw = Array.isArray(r.sources) ? r.sources : null;
      const sources =
        sourcesRaw
          ?.map((s: any) => ({
            imageKey: String(s?.imageKey ?? "").trim(),
            widthKey: String(s?.widthKey ?? "").trim(),
            heightKey: String(s?.heightKey ?? "").trim()
          }))
          .filter((s: any) => s.imageKey && s.widthKey && s.heightKey) ?? [];

      // 後方互換なし：sources が無ければ無効
      if (sources.length === 0) continue;

      normalized.push({ name, type, sources });
      continue;
    }
  }

  // 最低限の安全策：何も残らなければ img/picture だけは生かす
  if (normalized.length === 0) {
    return [
      { name: "img", type: "imgArgs" },
      { name: "picture", type: "pictureOpts" }
    ];
  }

  return normalized;
}

function normalizeName(s: string): string {
  return s.trim().replace(/^\+/, "").replace(/\($/, "");
}
