/**
 * Convert a model ID into a formatted model name.
 * Drops the prefix before "/", applies specific replacements, and appends " (Privatemode)".
 * @param modelId The model ID to convert.
 * @returns The formatted model name.
 */
export function convertModelIdToName(modelId: string): string {
	// Drop the prefix before "/"
	const parts = modelId.split("/");
	const baseId = parts[parts.length - 1];

	// Apply replacements
	let formattedName = baseId;
	formattedName = formattedName.startsWith("gpt-oss-") ? "gpt-oss" : formattedName;
	formattedName = formattedName.startsWith("qwen3-coder-") ? "Qwen3-Coder" : formattedName;

	// Append " (Privatemode)"
	return `${formattedName} (Privatemode)`;
}
