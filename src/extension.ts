import * as vscode from "vscode";
import { PrivatemodeChatModelProvider } from "./provider";

export function activate(context: vscode.ExtensionContext) {
	console.log("[Privatemode Extension] Activating extension");
	// Build a descriptive User-Agent to help quantify API usage
	const ext = vscode.extensions.getExtension("privatemode.privatemode-vscode");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `privatemode-vscode/${extVersion} VSCode/${vscodeVersion}`;

	const provider = new PrivatemodeChatModelProvider(context.secrets, ua);
	console.log("[Privatemode Extension] Registering provider with id: privatemode");
	// Register the Privatemode provider under the vendor id used in package.json
	vscode.lm.registerLanguageModelChatProvider("privatemode", provider);
	console.log("[Privatemode Extension] Provider registered successfully");

	// Management command to configure API key
	context.subscriptions.push(
		vscode.commands.registerCommand("privatemode.manage", async () => {
			const existing = await context.secrets.get("privatemode.apiKey");
			const apiKey = await vscode.window.showInputBox({
				title: "Privatemode API Key",
				prompt: existing
					? "Update your Privatemode API key or leave blank to remove it"
					: "Enter your Privatemode API key or leave blank if configured via the Privatemode proxy",
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete("privatemode.apiKey");
				vscode.window.showInformationMessage("Privatemode API key cleared.");
				return;
			}
			await context.secrets.store("privatemode.apiKey", apiKey.trim());
			vscode.window.showInformationMessage("Privatemode API key saved.");
		})
	);

	// Test command to verify extension is working
	context.subscriptions.push(
		vscode.commands.registerCommand("privatemode.test", async () => {
			vscode.window.showInformationMessage("Privatemode extension is active!");
		})
	);
}

export function deactivate() {}
