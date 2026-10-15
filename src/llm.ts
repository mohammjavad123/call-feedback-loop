// One place that talks to the LLM: structured JSON output + retries.
// Provider: LLM=gemini (default, GEMINI_API_KEY) or LLM=anthropic.
// Whatever the model says, quotes are checked against the transcript in code
// (verify.ts) and every number is counted in code, so the model never "decides" a fact.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import "./config.ts";

export type Effort = "low" | "medium" | "high";
type Usage = { input_tokens: number; output_tokens: number };

export const PROVIDER = (process.env.LLM ?? "gemini") as "gemini" | "anthropic";
export const MODEL_NAME = PROVIDER === "gemini" ? "gemini-2.5-pro" : "claude-opus-5-5";

let anthropic: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;

async function callAnthropic(opts: AskOpts): Promise<{ text: string; usage: Usage }> {
	// Explicit base URL: an inherited ANTHROPIC_BASE_URL (e.g. from a Claude Code shell)
	// would otherwise send the key to a different endpoint → "invalid x-api-key".
	anthropic ??= new Anthropic({ baseURL: "https://api.anthropic.com" });
	const stream = anthropic.messages.stream({
		model: "claude-opus-5-5",
		max_tokens: opts.maxTokens ?? 32000,
		thinking: { type: "adaptive" },
		output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
		system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
		messages: [{ role: "user", content: opts.user }],
	});
	const msg = await stream.finalMessage();
	if (msg.stop_reason === "refusal") throw new Error(`refusal: ${msg.stop_details?.category ?? "unknown"}`);
	if (msg.stop_reason === "max_tokens") throw new Error("hit max_tokens");
	return { text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""), usage: msg.usage };
}

const THINKING_BUDGET: Record<Effort, number> = { low: 1024, medium: 8192, high: 24576 };

async function callGemini(opts: AskOpts): Promise<{ text: string; usage: Usage }> {
	gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: Number(process.env.LLM_TIMEOUT_MS ?? 240000) } });
	const res = await gemini.models.generateContent({
		model: "gemini-2.5-pro",
		contents: opts.user,
		config: {
			systemInstruction: opts.system,
			responseMimeType: "application/json",
			responseJsonSchema: opts.schema,
			maxOutputTokens: Math.min(65536, (opts.maxTokens ?? 32000) + THINKING_BUDGET[opts.effort]),
			thinkingConfig: { thinkingBudget: THINKING_BUDGET[opts.effort] },
		},
	});
	const reason = res.candidates?.[0]?.finishReason;
	if (reason && reason !== "STOP") throw new Error(`gemini finish ${reason}`);
	const text = res.text ?? "";
	if (!text) throw new Error("gemini returned no text");
	return { text, usage: { input_tokens: res.usageMetadata?.promptTokenCount ?? 0, output_tokens: res.usageMetadata?.candidatesTokenCount ?? 0 } };
}

type AskOpts = { system: string; user: string; schema: Record<string, unknown>; effort: Effort; maxTokens?: number };

export async function askJson<T>(opts: AskOpts): Promise<{ data: T; usage: Usage }> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			const { text, usage } = PROVIDER === "gemini" ? await callGemini(opts) : await callAnthropic(opts);
			return { data: JSON.parse(text) as T, usage };
		} catch (e) {
			lastError = e;
			if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.BadRequestError) throw e;
			await new Promise((r) => setTimeout(r, 4000 * attempt));
		}
	}
	throw lastError;
}
