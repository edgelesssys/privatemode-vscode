import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatMessage,
	LanguageModelChatProvider,
	ProvideLanguageModelChatResponseOptions,
	LanguageModelResponsePart,
	Progress,
} from "vscode";

import type { OpenAIModel } from "./types";
import { convertTools, convertMessages, tryParseJSONObject, validateRequest } from "./utils";

import { countTokens } from "./tokenizer";
import { convertModelIdToName } from "./modelHelpers";

const BASE_URL = "http://localhost:8080/v1";
const DEFAULT_MAX_OUTPUT_TOKENS = 16000;

// Token estimates for gpt‑oss are correct as we use the appropriate tokenizer.
// For Qwen we must first create the tokenizer from the model, as it does not use tiktoken.
// As a workaround, we also use the gpt‑oss tokenizer for now and reduce the max context length here.
const DEFAULT_CONTEXT_LENGTH = 120000;

/**
 * VS Code Chat provider backed by Privatemode OpenAI API.
 */
export class PrivatemodeChatModelProvider implements LanguageModelChatProvider {
	private _chatEndpoints: { model: string; modelMaxPromptTokens: number }[] = [];
	/** Buffer for assembling streamed tool calls by index. */
	private _toolCallBuffers: Map<number, { id?: string; name?: string; args: string }> = new Map<
		number,
		{ id?: string; name?: string; args: string }
	>();

	/** Indices for which a tool call has been fully emitted. */
	private _completedToolCallIndices = new Set<number>();

	/** Track if we emitted any assistant text before seeing tool calls (SSE-like begin-tool-calls hint). */
	private _hasEmittedAssistantText = false;

	/** Track if we emitted the begin-tool-calls whitespace flush. */
	private _emittedBeginToolCallsHint = false;

	// Lightweight tokenizer state for tool calls embedded in text
	private _textToolParserBuffer = "";
	private _textToolActive:
		| undefined
		| {
				name?: string;
				index?: number;
				argBuffer: string;
				emitted?: boolean;
		  };
	private _emittedTextToolCallKeys = new Set<string>();
	private _emittedTextToolCallIds = new Set<string>();

	/**
	 * Create a provider using the given secret storage for the API key.
	 * @param secrets VS Code secret storage.
	 */
	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly userAgent: string
	) {}

	/** Roughly estimate tokens for VS Code chat messages (text only) */
	private estimateMessagesTokens(msgs: readonly vscode.LanguageModelChatMessage[]): number {
		let total = 0;
		for (const m of msgs) {
			for (const part of m.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					total += countTokens(part.value);
				}
			}
		}
		return total;
	}

	/** Rough token estimate for tool definitions by JSON size */
	private estimateToolTokens(
		tools: { type: string; function: { name: string; description?: string; parameters?: object } }[] | undefined
	): number {
		if (!tools || tools.length === 0) {
			return 0;
		}
		try {
			const json = JSON.stringify(tools);
			return countTokens(json);
		} catch {
			return 0;
		}
	}

	/**
	 * Get the list of available language models contributed by this provider
	 * @param options Options which specify the calling context of this function
	 * @param token A cancellation token which signals if the user cancelled the request or not
	 * @returns A promise that resolves to the list of available language models
	 */
	async prepareLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		console.log("[Privatemode Model Provider] prepareLanguageModelChatInformation called with options:", options);
		const apiKey = await this.ensureApiKey(options.silent);
		if (!apiKey && !options.silent) {
			// For localhost, API key is optional
		}

		const { models } = await this.fetchModels(apiKey);

		// Filter models to only include those with "qwen3-coder" or "gpt-oss" in their name
		let filteredModels = models.filter((model) => model.id.includes("qwen3-coder") || model.id.includes("gpt-oss"));

		// If there are multiple "gpt-oss" models, handle based on prefix presence to be forward compatible
		// with short model names
		const gptOssModels = filteredModels.filter((model) => model.id.includes("gpt-oss"));
		if (gptOssModels.length > 1) {
			// Check if we have duplicated models (with and without "openai/" prefix)
			const hasOpenAI_prefix = gptOssModels.some((model) => model.id.includes("openai/"));
			const hasNoOpenAI_prefix = gptOssModels.some((model) => !model.id.includes("openai/"));

			if (hasOpenAI_prefix && hasNoOpenAI_prefix) {
				// If we have duplicated models, keep only those without "openai/" prefix
				filteredModels = filteredModels.filter(
					(model) => !model.id.includes("gpt-oss") || !model.id.includes("openai/")
				);
			}
		}

		const infos: LanguageModelChatInformation[] = filteredModels.map((m) => {
			const contextLen = DEFAULT_CONTEXT_LENGTH; // Assume default
			const maxOutput = DEFAULT_MAX_OUTPUT_TOKENS;
			const maxInput = Math.max(1, contextLen - maxOutput);
			const toolCalling = Array.isArray(m.tasks) ? m.tasks.includes("tool_calling") : false;
			const info = {
				id: m.id,
				name: convertModelIdToName(m.id),
				tooltip: `${m.id} via Privatemode`,
				family: "privatemode",
				version: "1.0.0",
				maxInputTokens: maxInput,
				maxOutputTokens: maxOutput,
				capabilities: {
					toolCalling: toolCalling,
					imageInput: false, // Assume no image input for now
				},
			} satisfies LanguageModelChatInformation;
			console.log("[Privatemode Model Provider] Created model info:", info);
			return info;
		});

		console.log("[Privatemode Model Provider] Final model infos:", infos);

		this._chatEndpoints = infos.map((info) => ({
			model: info.id.replace("privatemode:", ""), // Remove prefix for API calls
			modelMaxPromptTokens: info.maxInputTokens + info.maxOutputTokens,
		}));

		console.log("[Privatemode Model Provider] Returning", infos.length, "model infos");
		return infos;
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		return this.prepareLanguageModelChatInformation({ silent: options.silent ?? false }, _token);
	}

	/**
	 * Fetch the list of models from the Privatemode OpenAI API.
	 * @param apiKey The optional API key used to authenticate.
	 */
	private async fetchModels(apiKey?: string): Promise<{ models: OpenAIModel[] }> {
		console.log("[Privatemode Model Provider] fetchModels called with apiKey present:", !!apiKey);
		const modelsList = (async () => {
			const headers: Record<string, string> = { "User-Agent": this.userAgent };
			if (apiKey) {
				headers["Authorization"] = `Bearer ${apiKey}`;
			}
			const resp = await fetch(`${BASE_URL}/models`, {
				method: "GET",
				headers,
			});
			console.log("[Privatemode Model Provider] Fetch response status:", resp.status, resp.statusText);
			if (!resp.ok) {
				let text = "";
				try {
					text = await resp.text();
				} catch (error) {
					console.error("[Privatemode Model Provider] Failed to read response text", error);
				}
				const err = new Error(
					`Failed to fetch Privatemode models: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ""}`
				);
				console.error("[Privatemode Model Provider] Failed to fetch Privatemode models", err);
				throw err;
			}
			const parsed = (await resp.json()) as { object: string; data: OpenAIModel[] };
			console.log("[Privatemode Model Provider] Raw models response:", parsed);
			return parsed.data ?? [];
		})();

		try {
			const models = await modelsList;
			console.log("[Privatemode Model Provider] Processed models array:", models);
			return { models };
		} catch (err) {
			if (err instanceof TypeError && err.message.includes("fetch")) {
				console.error(
					"[Privatemode Model Provider] Failed to connect to Privatemode proxy at localhost:8080. Please ensure the proxy is running."
				);
				throw new Error("Unable to connect to Privatemode proxy. Please start your local proxy on port 8080.");
			}
			console.error("[Privatemode Model Provider] Failed to fetch Privatemode models", err);
			throw err;
		}
	}

	/**
	 * Returns the response for a chat request, passing the results to the progress callback.
	 * The {@linkcode LanguageModelChatProvider} must emit the response parts to the progress callback as they are received from the language model.
	 * @param model The language model to use
	 * @param messages The messages to include in the request
	 * @param options Options for the request
	 * @param progress The progress to emit the streamed response chunks to
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves when the response is complete. Results are actually passed to the progress callback.
	 */
	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		this._toolCallBuffers.clear();
		this._completedToolCallIndices.clear();
		this._hasEmittedAssistantText = false;
		this._emittedBeginToolCallsHint = false;
		this._textToolParserBuffer = "";
		this._textToolActive = undefined;
		this._emittedTextToolCallKeys.clear();
		this._emittedTextToolCallIds.clear();

		let requestBody: Record<string, unknown> | undefined;
		const trackingProgress: Progress<LanguageModelResponsePart> = {
			report: (part) => {
				try {
					progress.report(part);
				} catch (e) {
					console.error("[Privatemode Model Provider] Progress.report failed", {
						modelId: model.id,
						error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
					});
				}
			},
		};
		try {
			const apiKey = await this.ensureApiKey(true); // Silent, optional
			if (!apiKey) {
				// No API key, proceed without auth
			}

			const openaiMessages = convertMessages(messages);

			validateRequest(messages);

			const toolConfig = convertTools(options);

			if (options.tools && options.tools.length > 128) {
				throw new Error("Cannot have more than 128 tools per request.");
			}

			const inputTokenCount = this.estimateMessagesTokens(messages);
			const toolTokenCount = this.estimateToolTokens(toolConfig.tools);
			const tokenLimit = Math.max(1, model.maxInputTokens);
			if (inputTokenCount + toolTokenCount > tokenLimit) {
				console.error("[Privatemode Model Provider] Message exceeds token limit", {
					total: inputTokenCount + toolTokenCount,
					tokenLimit,
				});
				throw new Error("Message exceeds token limit.");
			}

			requestBody = {
				model: model.id,
				messages: openaiMessages,
				stream: true,
				max_tokens: Math.min(options.modelOptions?.max_tokens || 4096, model.maxOutputTokens),
				temperature: options.modelOptions?.temperature ?? 0.7,
			};

			// Allow-list model options
			if (options.modelOptions) {
				const mo = options.modelOptions as Record<string, unknown>;
				if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
					(requestBody as Record<string, unknown>).stop = mo.stop;
				}
				if (typeof mo.frequency_penalty === "number") {
					(requestBody as Record<string, unknown>).frequency_penalty = mo.frequency_penalty;
				}
				if (typeof mo.presence_penalty === "number") {
					(requestBody as Record<string, unknown>).presence_penalty = mo.presence_penalty;
				}
			}

			if (toolConfig.tools) {
				(requestBody as Record<string, unknown>).tools = toolConfig.tools;
			}
			if (toolConfig.tool_choice) {
				(requestBody as Record<string, unknown>).tool_choice = toolConfig.tool_choice;
			}
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"User-Agent": this.userAgent,
			};
			if (apiKey) {
				headers["Authorization"] = `Bearer ${apiKey}`;
			}
			const response = await fetch(`${BASE_URL}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
			}).catch((err) => {
				if (err instanceof TypeError && err.message.includes("fetch")) {
					console.error(
						"[Privatemode Model Provider] Failed to connect to Privatemode server at localhost:8080. Please ensure the server is running."
					);
					throw new Error(
						"Unable to connect to Privatemode server. Please start your local OpenAI-compatible server on port 8080."
					);
				}
				throw err;
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("[Privatemode Model Provider] Privatemode API error response", errorText);
				throw new Error(
					`Privatemode API error: ${response.status} ${response.statusText}${errorText ? `\n${errorText}` : ""}`
				);
			}

			if (!response.body) {
				throw new Error("No response body from Privatemode API");
			}
			await this.processStreamingResponse(response.body, trackingProgress, token);
		} catch (err) {
			console.error("[Privatemode Model Provider] Chat request failed", {
				modelId: model.id,
				messageCount: messages.length,
				error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
			});
			throw err;
		}
	}

	/**
	 * Returns the number of tokens for a given text using the model specific tokenizer logic
	 * @param model The language model to use
	 * @param text The text to count tokens for
	 * @param token A cancellation token for the request
	 * @returns A promise that resolves to the number of tokens
	 */
	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage,
		_token: CancellationToken
	): Promise<number> {
		if (typeof text === "string") {
			return countTokens(text);
		} else {
			let totalTokens = 0;
			for (const part of text.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					totalTokens += countTokens(part.value);
				}
			}
			return totalTokens;
		}
	}

	private async ensureApiKey(silent: boolean): Promise<string | undefined> {
		let apiKey = await this.secrets.get("privatemode.apiKey");
		if (!apiKey && !silent) {
			const entered = await vscode.window.showInputBox({
				title: "Privatemode API Key",
				prompt: "Enter your Privatemode API key (optional)",
				ignoreFocusOut: true,
				password: true,
			});
			if (entered && entered.trim()) {
				apiKey = entered.trim();
				await this.secrets.store("privatemode.apiKey", apiKey);
			}
		}
		return apiKey;
	}

	/**
	 * Read and parse the HF Router streaming (SSE-like) response and report parts.
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
	private async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		const reader = responseBody.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) {
						continue;
					}
					const data = line.slice(6);
					if (data === "[DONE]") {
						// Do not throw on [DONE]; any incomplete/empty buffers are ignored.
						await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
						// Flush any in-progress text-embedded tool call (silent if incomplete)
						await this.flushActiveTextToolCall(progress);
						continue;
					}

					try {
						const parsed = JSON.parse(data);
						await this.processDelta(parsed, progress);
					} catch {
						// Silently ignore malformed SSE lines temporarily
					}
				}
			}
		} finally {
			reader.releaseLock();
			// Clean up any leftover tool call state
			this._toolCallBuffers.clear();
			this._completedToolCallIndices.clear();
			this._hasEmittedAssistantText = false;
			this._emittedBeginToolCallsHint = false;
			this._textToolParserBuffer = "";
			this._textToolActive = undefined;
			this._emittedTextToolCallKeys.clear();
		}
	}

	/**
	 * Handle a single streamed delta chunk, emitting text and tool call parts.
	 * @param delta Parsed SSE chunk from the Router.
	 * @param progress Progress reporter for parts.
	 */
	private async processDelta(
		delta: Record<string, unknown>,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<boolean> {
		let emitted = false;
		const choice = (delta.choices as Record<string, unknown>[] | undefined)?.[0];
		if (!choice) {
			return false;
		}

		const deltaObj = choice.delta as Record<string, unknown> | undefined;

		// report thinking progress if backend provides it and host supports it
		try {
			const maybeThinking =
				(choice as Record<string, unknown> | undefined)?.thinking ??
				(deltaObj as Record<string, unknown> | undefined)?.thinking;
			if (maybeThinking !== undefined) {
				const vsAny = vscode as unknown as Record<string, unknown>;
				const ThinkingCtor = vsAny["LanguageModelThinkingPart"] as
					| (new (text: string, id?: string, metadata?: unknown) => unknown)
					| undefined;
				if (ThinkingCtor) {
					let text = "";
					let id: string | undefined;
					let metadata: unknown;
					if (maybeThinking && typeof maybeThinking === "object") {
						const mt = maybeThinking as Record<string, unknown>;
						text = typeof mt["text"] === "string" ? (mt["text"] as string) : "";
						id = typeof mt["id"] === "string" ? (mt["id"] as string) : undefined;
						metadata = mt["metadata"];
					} else if (typeof maybeThinking === "string") {
						text = maybeThinking;
					}
					if (text) {
						progress.report(
							new (ThinkingCtor as new (text: string, id?: string, metadata?: unknown) => unknown)(
								text,
								id,
								metadata
							) as unknown as vscode.LanguageModelResponsePart
						);
						emitted = true;
					}
				}
			}
		} catch {
			// ignore errors here temporarily
		}
		if (deltaObj?.content) {
			const content = String(deltaObj.content);
			const res = this.processTextContent(content, progress);
			if (res.emittedText) {
				this._hasEmittedAssistantText = true;
			}
			if (res.emittedAny) {
				emitted = true;
			}
		}

		if (deltaObj?.tool_calls) {
			const toolCalls = deltaObj.tool_calls as Array<Record<string, unknown>>;

			// SSEProcessor-like: if first tool call appears after text, emit a whitespace
			// to ensure any UI buffers/linkifiers are flushed without adding visible noise.
			if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
				progress.report(new vscode.LanguageModelTextPart(" "));
				this._emittedBeginToolCallsHint = true;
			}

			for (const tc of toolCalls) {
				const idx = (tc.index as number) ?? 0;
				// Ignore any further deltas for an index we've already completed
				if (this._completedToolCallIndices.has(idx)) {
					continue;
				}
				const buf = this._toolCallBuffers.get(idx) ?? { args: "" };
				if (tc.id && typeof tc.id === "string") {
					buf.id = tc.id as string;
				}
				const func = tc.function as Record<string, unknown> | undefined;
				if (func?.name && typeof func.name === "string") {
					buf.name = func.name as string;
				}
				if (typeof func?.arguments === "string") {
					buf.args += func.arguments as string;
				}
				this._toolCallBuffers.set(idx, buf);

				// Emit immediately once arguments become valid JSON to avoid perceived hanging
				await this.tryEmitBufferedToolCall(idx, progress);
			}
		}

		const finish = (choice.finish_reason as string | undefined) ?? undefined;
		if (finish === "tool_calls" || finish === "stop") {
			// On both 'tool_calls' and 'stop', emit any buffered calls and throw on invalid JSON
			await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ true);
		}
		return emitted;
	}

	/**
	 * Process streamed text content for inline tool-call control tokens and emit text/tool calls.
	 * Returns which parts were emitted for logging/flow control.
	 */
	private processTextContent(
		input: string,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): { emittedText: boolean; emittedAny: boolean } {
		const BEGIN = "<|tool_call_begin|>";
		const ARG_BEGIN = "<|tool_call_argument_begin|>";
		const END = "<|tool_call_end|>";

		let data = this._textToolParserBuffer + input;
		let emittedText = false;
		let emittedAny = false;
		let visibleOut = "";

		while (data.length > 0) {
			if (!this._textToolActive) {
				const b = data.indexOf(BEGIN);
				if (b === -1) {
					// No tool-call start: emit visible portion, but keep any partial BEGIN prefix as buffer
					const longestPartialPrefix = ((): number => {
						for (let k = Math.min(BEGIN.length - 1, data.length - 1); k > 0; k--) {
							if (data.endsWith(BEGIN.slice(0, k))) {
								return k;
							}
						}
						return 0;
					})();
					if (longestPartialPrefix > 0) {
						const visible = data.slice(0, data.length - longestPartialPrefix);
						if (visible) {
							visibleOut += this.stripControlTokens(visible);
						}
						this._textToolParserBuffer = data.slice(data.length - longestPartialPrefix);
						data = "";
						break;
					} else {
						// All visible, clean other control tokens
						visibleOut += this.stripControlTokens(data);
						data = "";
						break;
					}
				}
				// Emit text before the token
				const pre = data.slice(0, b);
				if (pre) {
					visibleOut += this.stripControlTokens(pre);
				}
				// Advance past BEGIN
				data = data.slice(b + BEGIN.length);

				// Find the delimiter that ends the name/index segment
				const a = data.indexOf(ARG_BEGIN);
				const e = data.indexOf(END);
				let delimIdx = -1;
				let delimKind: "arg" | "end" | undefined = undefined;
				if (a !== -1 && (e === -1 || a < e)) {
					delimIdx = a;
					delimKind = "arg";
				} else if (e !== -1) {
					delimIdx = e;
					delimKind = "end";
				} else {
					// Incomplete header; keep for next chunk (re-add BEGIN so we don't lose it)
					this._textToolParserBuffer = BEGIN + data;
					data = "";
					break;
				}

				const header = data.slice(0, delimIdx).trim();
				const m = header.match(/^([A-Za-z0-9_\-.]+)(?::(\d+))?/);
				const name = m?.[1] ?? undefined;
				const index = m?.[2] ? Number(m?.[2]) : undefined;
				this._textToolActive = { name, index, argBuffer: "", emitted: false };
				// Advance past delimiter token
				if (delimKind === "arg") {
					data = data.slice(delimIdx + ARG_BEGIN.length);
				} /* end */ else {
					// No args, finalize immediately
					data = data.slice(delimIdx + END.length);
					const did = this.emitTextToolCallIfValid(progress, this._textToolActive, "{}");
					if (did) {
						this._textToolActive.emitted = true;
						emittedAny = true;
					}
					this._textToolActive = undefined;
				}
				continue;
			}

			// We are inside arguments, collect until END and emit as soon as JSON becomes valid
			const e2 = data.indexOf(END);
			if (e2 === -1) {
				// No end marker yet, accumulate and check for early valid JSON
				this._textToolActive.argBuffer += data;
				// Early emit when JSON becomes valid and we haven't emitted yet
				if (!this._textToolActive.emitted) {
					const did = this.emitTextToolCallIfValid(progress, this._textToolActive, this._textToolActive.argBuffer);
					if (did) {
						this._textToolActive.emitted = true;
						emittedAny = true;
					}
				}
				data = "";
				break;
			} else {
				this._textToolActive.argBuffer += data.slice(0, e2);
				// Consume END
				data = data.slice(e2 + END.length);
				// Final attempt to emit if not already
				if (!this._textToolActive.emitted) {
					const did = this.emitTextToolCallIfValid(progress, this._textToolActive, this._textToolActive.argBuffer);
					if (did) {
						emittedAny = true;
					}
				}
				this._textToolActive = undefined;
				continue;
			}
		}

		// Emit any visible text
		const textToEmit = visibleOut;
		if (textToEmit && textToEmit.length > 0) {
			progress.report(new vscode.LanguageModelTextPart(textToEmit));
			emittedText = true;
			emittedAny = true;
		}

		// Store leftover for next chunk
		this._textToolParserBuffer = data;

		return { emittedText, emittedAny };
	}

	private emitTextToolCallIfValid(
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		call: { name?: string; index?: number; argBuffer: string; emitted?: boolean },
		argText: string
	): boolean {
		const name = call.name ?? "unknown_tool";
		const parsed = tryParseJSONObject(argText);
		if (!parsed.ok) {
			return false;
		}
		const canonical = JSON.stringify(parsed.value);
		const key = `${name}:${canonical}`;
		// identity-based dedupe when index is present
		if (typeof call.index === "number") {
			const idKey = `${name}:${call.index}`;
			if (this._emittedTextToolCallIds.has(idKey)) {
				return false;
			}
			// Mark identity as emitted
			this._emittedTextToolCallIds.add(idKey);
		} else if (this._emittedTextToolCallKeys.has(key)) {
			return false;
		}
		this._emittedTextToolCallKeys.add(key);
		const id = `tct_${Math.random().toString(36).slice(2, 10)}`;
		progress.report(new vscode.LanguageModelToolCallPart(id, name, parsed.value));
		return true;
	}

	private async flushActiveTextToolCall(progress: vscode.Progress<vscode.LanguageModelResponsePart>): Promise<void> {
		if (!this._textToolActive) {
			return;
		}
		const argText = this._textToolActive.argBuffer;
		const parsed = tryParseJSONObject(argText);
		if (!parsed.ok) {
			return;
		}
		// Emit (dedupe ensures we don't double-emit)
		this.emitTextToolCallIfValid(progress, this._textToolActive, argText);
		this._textToolActive = undefined;
	}

	/**
	 * Try to emit a buffered tool call when a valid name and JSON arguments are available.
	 * @param index The tool call index from the stream.
	 * @param progress Progress reporter for parts.
	 */
	private async tryEmitBufferedToolCall(
		index: number,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		const buf = this._toolCallBuffers.get(index);
		if (!buf) {
			return;
		}
		if (!buf.name) {
			return;
		}
		const canParse = tryParseJSONObject(buf.args);
		if (!canParse.ok) {
			return;
		}
		const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
		const parameters = canParse.value;
		try {
			const canonical = JSON.stringify(parameters);
			this._emittedTextToolCallKeys.add(`${buf.name}:${canonical}`);
		} catch {
			/* ignore */
		}
		progress.report(new vscode.LanguageModelToolCallPart(id, buf.name, parameters));
		this._toolCallBuffers.delete(index);
		this._completedToolCallIndices.add(index);
	}

	/**
	 * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
	 * @param progress Progress reporter for parts.
	 * @param throwOnInvalid If true, throw when a tool call has invalid JSON args.
	 */
	private async flushToolCallBuffers(
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		throwOnInvalid: boolean
	): Promise<void> {
		if (this._toolCallBuffers.size === 0) {
			return;
		}
		for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
			const parsed = tryParseJSONObject(buf.args);
			if (!parsed.ok) {
				if (throwOnInvalid) {
					console.error("[Privatemode Model Provider] Invalid JSON for tool call", {
						idx,
						snippet: (buf.args || "").slice(0, 200),
					});
					throw new Error("Invalid JSON for tool call");
				}
				// When not throwing (e.g. on [DONE]), drop silently to reduce noise
				continue;
			}
			const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
			const name = buf.name ?? "unknown_tool";
			try {
				const canonical = JSON.stringify(parsed.value);
				this._emittedTextToolCallKeys.add(`${name}:${canonical}`);
			} catch {
				/* ignore */
			}
			progress.report(new vscode.LanguageModelToolCallPart(id, name, parsed.value));
			this._toolCallBuffers.delete(idx);
			this._completedToolCallIndices.add(idx);
		}
	}

	/** Strip provider control tokens like <|tool_calls_section_begin|> and <|tool_call_begin|> from streamed text. */
	private stripControlTokens(text: string): string {
		try {
			// Remove section markers and explicit tool call begin/argument/end markers that some backends stream as text
			return text
				.replace(/<\|[a-zA-Z0-9_-]+_section_(?:begin|end)\|>/g, "")
				.replace(/<\|tool_call_(?:argument_)?(?:begin|end)\|>/g, "");
		} catch {
			return text;
		}
	}
}
