// Stage 5 — group the verified feedback into themes, deterministically.
//
// 1. Split by polarity first (problems, blockers, strengths, requests, context) so praise
//    and complaints about the same feature never land in one theme.
// 2. Embed each item's English summary (OpenAI text-embedding-3-large, cached).
// 3. Average-linkage agglomerative clustering on cosine similarity, cut at a fixed
//    threshold. Same input → same themes → same counts, every run.
// 4. The LLM only NAMES each finished cluster; it cannot move, add or drop items.
import type { Item } from "./extract.ts";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { path, pool, PROFILE, readJson, writeJson } from "./config.ts";
import { askJson } from "./llm.ts";
import { countableItems } from "./items.ts";

export type ThemeKind = "problem" | "adoption_blocker" | "strength" | "request" | "context";
export type Theme = {
	key: string;
	name: string;
	kind: ThemeKind;
	area: string;
	insight: string;
	recommendation: string;
	item_ids: string[];
	cohesion: number;
};

export const GROUP_OF: Record<Item["category"], ThemeKind> = {
	complaint: "problem",
	bug: "problem",
	confusion: "problem",
	gap: "problem",
	objection: "adoption_blocker",
	praise: "strength",
	feature_request: "request",
	use_case: "context",
	pricing: "context",
	competitor: "context",
};

export const THRESHOLD = Number(process.env.THRESHOLD ?? 0.45);
export const MIN_CALLS = 3;
const EMBED_MODEL = "text-embedding-3-large";

// ---------- embeddings (cached by text hash) ----------
export async function embedAll(texts: string[]): Promise<Float32Array[]> {
	const cacheFile = path("embeddings.json");
	const cache = readJson<Record<string, number[]>>(cacheFile, {});
	const key = (t: string) => createHash("sha1").update(`${EMBED_MODEL}:${t}`).digest("hex");
	const missing = [...new Set(texts.filter((t) => !cache[key(t)]))];
	if (missing.length) {
		const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1" });
		for (let i = 0; i < missing.length; i += 256) {
			const batch = missing.slice(i, i + 256);
			const res = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
			res.data.forEach((d, j) => (cache[key(batch[j])] = d.embedding));
		}
		writeJson(cacheFile, cache);
	}
	return texts.map((t) => {
		const v = Float32Array.from(cache[key(t)]);
		let n = 0;
		for (const x of v) n += x * x;
		n = Math.sqrt(n);
		return v.map((x) => x / n);
	});
}

// ---------- topic text: drop who-said-it so clusters form on WHAT was said ----------
const TEAM_NAMES = PROFILE.teamNames;
export function topicText(summary: string, speakerNames: string[]): string {
	const names = [...new Set([...TEAM_NAMES, ...speakerNames.flatMap((n) => n.split(/\s+/)).filter((w) => /^[A-Z][a-z]{2,}$/.test(w))])];
	let t = summary;
	for (const n of names) t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}('s)?\\b`, "g"), "");
	t = t.replace(/\b(the )?(founder|candidate|prospect|coach|team|he|she|they)\b\s+(confirms|confirmed|admits|admitted|states|stated|says|said|explains|explained|notes|noted|mentions|mentioned|reports|reported)( that)?/gi, "");
	t = t.replace(/\b(confirms|confirmed|admits|admitted|states|stated|explains|explained|notes|noted|mentions|mentioned)( that)?\b/gi, "");
	return t.replace(/\s+/g, " ").replace(/^[\s,;:.-]+/, "").trim();
}

// ---------- average-linkage clustering (nearest-neighbour chain, O(n²)) ----------
export function averageLinkage(vecs: Float32Array[], threshold: number): number[][] {
	const n = vecs.length;
	if (n === 0) return [];
	const S = new Float32Array(n * n);
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			let d = 0;
			const a = vecs[i], b = vecs[j];
			for (let k = 0; k < a.length; k++) d += a[k] * b[k];
			S[i * n + j] = S[j * n + i] = d;
		}
	const size = new Array(n).fill(1);
	const alive = new Array(n).fill(true);
	const members: number[][] = vecs.map((_, i) => [i]);
	const merges: [number, number, number][] = [];
	const chain: number[] = [];
	let remaining = n;
	while (remaining > 1) {
		if (chain.length === 0) chain.push(alive.indexOf(true));
		const a = chain[chain.length - 1];
		// nearest (most similar) alive neighbour of a; ties broken by lowest index → deterministic
		let best = -1, bestSim = -Infinity;
		for (let j = 0; j < n; j++) {
			if (j === a || !alive[j]) continue;
			const s = S[a * n + j];
			if (s > bestSim) (bestSim = s), (best = j);
		}
		const prev = chain.length > 1 ? chain[chain.length - 2] : -1;
		if (prev !== -1 && S[a * n + prev] >= bestSim) {
			// reciprocal nearest neighbours → merge a into prev
			chain.pop();
			chain.pop();
			const sim = S[a * n + prev];
			merges.push([prev, a, sim]);
			for (let j = 0; j < n; j++) {
				if (!alive[j] || j === a || j === prev) continue;
				const v = (size[prev] * S[prev * n + j] + size[a] * S[a * n + j]) / (size[prev] + size[a]);
				S[prev * n + j] = S[j * n + prev] = v;
			}
			size[prev] += size[a];
			members[prev] = members[prev].concat(members[a]);
			alive[a] = false;
			remaining--;
		} else {
			chain.push(best);
		}
	}
	// Average linkage is reducible, so cutting = keeping only merges at or above the threshold.
	const parent = vecs.map((_, i) => i);
	const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
	for (const [p, a, sim] of merges) if (sim >= threshold) parent[find(a)] = find(p);
	const groups = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		groups.set(r, [...(groups.get(r) ?? []), i]);
	}
	return [...groups.values()].sort((x, y) => y.length - x.length || x[0] - y[0]);
}

function cohesion(idx: number[], vecs: Float32Array[]): number {
	if (idx.length < 2) return 1;
	let sum = 0, cnt = 0;
	for (let i = 0; i < idx.length; i++)
		for (let j = i + 1; j < idx.length; j++) {
			let d = 0;
			const a = vecs[idx[i]], b = vecs[idx[j]];
			for (let k = 0; k < a.length; k++) d += a[k] * b[k];
			sum += d;
			cnt++;
		}
	return sum / cnt;
}

// ---------- naming (LLM writes words, never moves items) ----------
const NAME_SYSTEM = `You name one cluster of real feedback about ${PROFILE.product}. ${PROFILE.productDescription}
The items were already grouped by meaning. Do not judge the grouping — say precisely what they have in common.
- name: the concrete finding in plain words, max 8 words, specific nouns, no hype, no product name, no "users" if you can name who.
  Good: "Founders don't know what to upload first", "Studios love the per-call coaching", "Google blocks the calendar connection".
  Bad: "Concept resonates", "Confusion about the platform", "Valuable insights".
- insight: 1–2 short sentences: what exactly people say, who says it (founders, studios, candidates), how strongly. Only what the items say.
- recommendation: one short sentence the product team can act on. For strengths: what to protect or amplify.
- area: the main product area (pick from the areas given).
Return JSON only.`;
const NAME_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["name", "insight", "recommendation", "area"],
	properties: { name: { type: "string" }, insight: { type: "string" }, recommendation: { type: "string" }, area: { type: "string" } },
};

// ---------- run ----------
if (import.meta.url === `file://${process.argv[1]}`) {
	const items = countableItems();
	const speakerNames = [...new Set(items.map((x) => x.speaker))];
	const vecs = await embedAll(items.map((x) => topicText(x.summary, speakerNames)));
	const vecOf = new Map(items.map((x, i) => [x.id, vecs[i]]));
	const kinds: ThemeKind[] = ["problem", "adoption_blocker", "strength", "request", "context"];
	const raw: { kind: ThemeKind; members: Item[]; cohesion: number }[] = [];
	for (const kind of kinds) {
		const group = items.filter((x) => GROUP_OF[x.category] === kind);
		const gv = group.map((x) => vecOf.get(x.id)!);
		for (const idx of averageLinkage(gv, THRESHOLD)) {
			const members = idx.map((i) => group[i]);
			if (new Set(members.map((m) => m.call_id)).size < MIN_CALLS) continue; // a theme must come from ≥3 calls
			raw.push({ kind, members, cohesion: cohesion(idx, gv) });
		}
	}
	console.log(`themes: ${raw.length} clusters from ${items.length} items — naming…`);
	let doneN = 0;
	const named = await pool(raw, 12, async (c, i) => {
		const areaCounts = new Map<string, number>();
		for (const m of c.members) areaCounts.set(m.area, (areaCounts.get(m.area) ?? 0) + 1);
		const user = `Kind: ${c.kind}. Areas in cluster: ${[...areaCounts].map(([a, n]) => `${a} (${n})`).join(", ")}.
${c.members.length} items (side | strength | summary):
${c.members.slice(0, 40).map((m) => `- ${m.side} | s${m.strength} | ${m.summary} | quote: "${m.quote.slice(0, 160)}"`).join("\n")}`;
		const { data } = await askJson<{ name: string; insight: string; recommendation: string; area: string }>({ system: NAME_SYSTEM, user, schema: NAME_SCHEMA, effort: "low", maxTokens: 3000 });
		const topArea = [...areaCounts].sort((a, b) => b[1] - a[1])[0][0];
		if (++doneN % 20 === 0) console.log(`  named ${doneN}/${raw.length}`);
		return {
			key: `${c.kind}-${i}`,
			name: data.name,
			kind: c.kind,
			area: areaCounts.has(data.area) ? data.area : topArea,
			insight: data.insight,
			recommendation: data.recommendation,
			item_ids: c.members.map((m) => m.id),
			cohesion: Math.round(c.cohesion * 100) / 100,
		} satisfies Theme;
	});
	const used = named.reduce((a, t) => a + t.item_ids.length, 0);
	writeJson(path("themes.json"), { generated_at: new Date().toISOString(), method: { embed: EMBED_MODEL, linkage: "average", threshold: THRESHOLD, min_calls: MIN_CALLS }, themes: named });
	console.log(`themes: ${named.length} themes (threshold ${THRESHOLD}) hold ${used}/${items.length} verified items; the rest stay "not in a theme"`);
}
