import * as vscode from "vscode";
import { runInsert } from "./core/applyEdits";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("PugMixinImageDimension.insertFull", async () => {
      await runInsert({ mode: "full" });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("PugMixinImageDimension.insertHalf", async () => {
      await runInsert({ mode: "half" });
    })
  );
}

export function deactivate() {}
