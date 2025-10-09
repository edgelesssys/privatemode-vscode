import { encoding_for_model } from "tiktoken";

// gpt-oss uses gpt-4o encoding
const default_encoding = encoding_for_model("gpt-4o");

/**
 * Count tokens using tiktoken for accurate tokenization.
 * @param text The text to count tokens for.
 * @param model The model name to use for encoding (defaults to "gpt-4").
 * @returns The number of tokens.
 */
export function countTokens(text: string): number {
	try {
		// avoid special tokens with encode_ordinary
		const tokens = default_encoding.encode_ordinary(text);
		if (tokens.length > 120000) {
			console.log("[Privatemode Model Provider] countTokens", { textLength: text.length, tokenCount: tokens.length });
		}
		return tokens.length;
	} catch (error) {
		console.warn("[Privatemode Model Provider] Failed to count tokens with tiktoken, falling back to estimate", error);
		return Math.ceil(text.length / 4);
	}
}
