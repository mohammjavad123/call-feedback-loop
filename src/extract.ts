// Stage 4 — read each relevant call in full and pull out every piece of feedback
// about the product, each backed by a verbatim quote. Then CHECK every quote against
// the transcript in code: a quote that is not really there is dropped, never shown.
import type { CallMeta } from "./pull.ts";
import type { Screen } from "./screen.ts";
import type { Segment } from "./fetch.ts";
import { createHash } from "node:crypto";
import { path, pool, PROFILE, readJson, TEAM_EMAIL_DOMAIN, writeJson } from "./config.ts";
import { askJson } from "./llm.ts";
import { locateQuote } from "./verify.ts";

export const CATEGORIES = ["praise", "complaint", "bug", "confusion", "feature_request", "gap", "objection", "pricing", "competitor", "use_case"] as const;
export const AREAS = [
	"capture_upload",
	"transcription_speakers",
	"reflections_coaching",
	"insights_signals",
	"scores_evidence_tiers",
	"context_canvas",
	"threads_companies",
	"chat_mcp_claude",
	"integrations",
	"onboarding_setup",
	"studio_portfolio",
	"pricing_packaging",
	"trust_privacy",
	"performance_reliability",
	"overall_value",
] as const;

export type RawItem = {
	category: (typeof CATEGORIES)[number];
	area: (typeof AREAS)[number];
	summary: string;
	quote: string;
	segment: number;
	speaker: string;
	speaker_side: "external" | "team";
	strength: 1 | 2 | 3;
};

export type Item = RawItem & {
	id: string;
	call_id: string;
	verified: boolean;
	found_segment: number | null;
	side: "external" | "team";
};

const PROMPT_VERSION = "v2";

const P = PROFILE;
const SYSTEM = `You read one recorded call from ${P.org}, ${P.orgDescription}. ${P.org} makes ${P.product} (also called ${P.productAliases.join(", ")}).
${P.productDescription}

Extract EVERY piece of feedback about ${P.product} as a product — nothing else. Feedback about the other party's own business is NOT ${P.product} feedback.
Categories:
- praise: something about ${P.product} that works, helps, delights, changed how they work
- complaint: something annoying, slow, wrong or disappointing in ${P.product}
- bug: something broken (fails, errors, missing data, wrong output)
- confusion: they do not understand a part of ${P.product} (what a score means, where to find something)
- feature_request: a concrete capability they ask for
- gap: a need ${P.product} does not cover, incl. "we use X for that instead"
- objection: a reason not to buy, adopt or keep using ${P.product}
- pricing: price, budget, pilot, licence, who pays
- competitor: comparing ${P.product} to another tool or their own setup
- use_case: how they actually use or would use ${P.product}
Rules:
- quote = the exact words from the transcript, original language, copied character for character, max ~40 words, from ONE segment.
- segment = the [n] number of the segment the quote is in.
- speaker = the name shown on that segment (may be a letter like "A" or "B" when the speaker is unnamed).
- speaker_side = "team" if the speaker is from ${P.org} (they pitch or explain ${P.product}, coach, run the call${P.teamNames.length ? `; names include ${P.teamNames.join(", ")}` : ""}), otherwise "external".
  For unnamed speakers decide from context: who presents ${P.product} vs who asks about it or uses it.
- summary = one specific English sentence a product team can act on.
- strength: 1 passing remark, 2 clear point, 3 strong / emotional / repeated.
- Feedback said by the ${P.org} team counts too (e.g. a coach reporting what users struggle with).
- Never invent. If the call has no ${P.product} feedback, return an empty list.
Return JSON only.`;

const SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["items"],
	properties: {
		items: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["category", "area", "summary", "quote", "segment", "speaker", "speaker_side", "strength"],
				properties: {
					category: { type: "string", enum: [...CATEGORIES] },
					area: { type: "string", enum: [...AREAS] },
					summary: { type: "string" },
					quote: { type: "string" },
					segment: { type: "integer" },
					speaker: { type: "string" },
					speaker_side: { type: "string", enum: ["external", "team"] },
					strength: { type: "integer", enum: [1, 2, 3] },
				},
			},
		},
	},
};

function render(c: CallMeta, s: Screen, segs: Segment[]): string {
	const people = (c.speakers ?? []).map((p) => `${p.name}${p.email?.endsWith(TEAM_EMAIL_DOMAIN) ? " (team)" : ""}`).join(", ");
	return `CALL: ${c.outcome ?? ""} (stored title: ${c.title ?? "-"}) | date ${String(c.recorded_at ?? "").slice(0, 10)} | company ${c.company ?? "-"} | kind ${s.call_kind}
People: ${people}
TRANSCRIPT:
${segs.map((x) => `[${x.seq}] ${x.who ?? "?"}: ${x.text}`).join("\n")}`;
}

const calls = new Map(readJson<CallMeta[]>(path("calls.json"), []).map((c) => [c.id, c]));
const keep = readJson<Screen[]>(path("screened.json"), []).filter((s) => s.relevant);
let fresh = 0;
let failed = 0;

const perCall = await pool(keep, Number(process.env.C ?? 6), async (s) => {
	const file = path("extract", `${s.id}.json`);
	const cached = readJson<{ version: string; items: Item[] } | null>(file, null);
	if (cached?.version === PROMPT_VERSION) return cached.items;
	const c = calls.get(s.id);
	const segs = readJson<Segment[]>(path("transcripts", `${s.id}.json`), []);
	if (!c || segs.length === 0) return [];
	try {
		const { data } = await askJson<{ items: RawItem[] }>({ system: SYSTEM, user: render(c, s, segs), schema: SCHEMA, effort: "medium", maxTokens: 48000 });
		const items: Item[] = data.items.map((raw, i) => {
			const found = locateQuote(raw.quote, segs, raw.segment);
			const seg = segs.find((x) => x.seq === (found ?? raw.segment));
			// A known email decides; unnamed speakers ("A", "B") fall back to the model's reading of the call.
			const team = seg?.email ? seg.email.endsWith(TEAM_EMAIL_DOMAIN) : (raw.speaker_side as string) !== "external";
			return {
				...raw,
				id: createHash("sha1").update(`${s.id}:${i}:${raw.quote}`).digest("hex").slice(0, 12),
				call_id: s.id,
				verified: found !== null,
				found_segment: found,
				side: team ? "team" : "external",
			};
		});
		writeJson(file, { version: PROMPT_VERSION, items });
		fresh++;
		console.log(`  ${fresh + failed}/${keep.length} ${items.length} items (${items.filter((x) => !x.verified).length} unverified) | ${(c.outcome ?? c.title ?? "").slice(0, 60)}`);
		return items;
	} catch (e) {
		failed++;
		console.error(`  FAIL ${s.id}: ${String(e).slice(0, 160)}`);
		return [];
	}
});

const all = perCall.flat();
writeJson(path("items.json"), all);
const verified = all.filter((x) => x.verified).length;
console.log(`extract: ${fresh} calls newly read, ${failed} failed; ${all.length} items, ${verified} with the quote found in the transcript (${Math.round((100 * verified) / Math.max(1, all.length))}%)`);
