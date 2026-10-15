// Stage 2 — decide which calls are worth reading in full.
// Keep a call only if people in it actually talk about the product itself
// (using it, reacting to it, asking for something, objecting, pricing) in the context
// of customer discovery / venture building. Hiring interviews and unrelated calls drop.
import type { CallMeta } from "./pull.ts";
import { path, pool, PROFILE, readJson, TEAM_EMAIL_DOMAIN, writeJson } from "./config.ts";
import { askJson } from "./llm.ts";

export type Screen = {
	id: string;
	call_kind:
		| "founder_checkin"
		| "founder_onboarding"
		| "founder_recruitment"
		| "prospect_studio_fund_corporate"
		| "existing_client"
		| "partner_or_investor"
		| "internal_team"
		| "hiring_interview"
		| "other";
	product_talk: "none" | "light" | "substantial";
	relevant: boolean;
	reason: string;
};

const P = PROFILE;
const NAMES = [P.product, ...P.productAliases].map((n) => `"${n}"`).join(", ");
const SYSTEM = `You screen recorded calls from ${P.org}, ${P.orgDescription}.
${P.org} makes a product called ${P.product} (people may say ${NAMES}).
${P.productDescription}
${P.callTypes}

Decide if the call contains product feedback: people talking about ${P.product} itself — using it, reacting to a demo, praising or complaining, asking for features, comparing it to other tools, objecting, talking price or pilots.
Words like "signal", "platform" or "dashboard" can also be normal business talk about the other party's OWN product — that is NOT ${P.product} talk.
- product_talk "none": ${P.product} is never discussed as a product (or only named in passing).
- "light": a few concrete remarks about ${P.product}.
- "substantial": a real stretch of discussion about ${P.product}.
Judge product_talk ONLY on whether ${P.product} itself is discussed, whatever kind of call it is.
call_kind "founder_recruitment" = ${P.org} interviewing a startup founder for its programme. That is NOT a hiring interview.
call_kind "hiring_interview" = recruiting an EMPLOYEE for ${P.org} (engineer, designer, intern).
relevant = product_talk is "light" or "substantial" (the code re-derives this; just be consistent).
Return JSON only.`;

const SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["call_kind", "product_talk", "relevant", "reason"],
	properties: {
		call_kind: {
			type: "string",
			enum: ["founder_checkin", "founder_onboarding", "founder_recruitment", "prospect_studio_fund_corporate", "existing_client", "partner_or_investor", "internal_team", "hiring_interview", "other"],
		},
		product_talk: { type: "string", enum: ["none", "light", "substantial"] },
		relevant: { type: "boolean" },
		reason: { type: "string", description: "One short sentence: why." },
	},
};

function render(c: CallMeta): string {
	const people = (c.speakers ?? [])
		.map((s) => `${s.name}${s.email?.endsWith(TEAM_EMAIL_DOMAIN) ? " (team)" : ""}`)
		.join(", ");
	const samples = (c.hit_samples ?? []).map((s) => `[${s.seq}] ${s.text}`).join("\n");
	return `CALL: ${c.outcome ?? ""} (stored title: ${c.title ?? "-"})
Date: ${String(c.recorded_at ?? "").slice(0, 10)} | Company: ${c.company ?? "-"} | Type: ${c.call_type ?? "-"}
People: ${people || "-"}
Machine summary (may be wrong): ${c.summary ?? "-"}
Transcript segments matching product words: ${c.product_hits} of ${c.segments}
Samples:
${samples || "(none)"}`;
}

const calls = readJson<CallMeta[]>(path("calls.json"), []);
let fresh = 0;
const results = await pool(calls, 8, async (c) => {
	const file = path("screen", `${c.id}.json`);
	const cached = readJson<Screen | null>(file, null);
	if (cached) return cached;
	if (c.segments === 0) {
		const s: Screen = { id: c.id, call_kind: "other", product_talk: "none", relevant: false, reason: "no transcript" };
		writeJson(file, s);
		return s;
	}
	const { data } = await askJson<Omit<Screen, "id">>({ system: SYSTEM, user: render(c), schema: SCHEMA, effort: "low", maxTokens: 4000 });
	// Keep/drop is decided in code from the two answers, not from the model's own boolean.
	const s: Screen = { id: c.id, ...data, relevant: data.product_talk !== "none" && data.call_kind !== "hiring_interview" };
	writeJson(file, s);
	fresh++;
	return s;
});

const relevant = results.filter((r) => r.relevant);
const byKind = new Map<string, number>();
for (const r of relevant) byKind.set(r.call_kind, (byKind.get(r.call_kind) ?? 0) + 1);
writeJson(path("screened.json"), results);
console.log(`screen: ${fresh} newly screened, ${relevant.length}/${results.length} calls have product talk`);
console.log("  by kind:", Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])));
