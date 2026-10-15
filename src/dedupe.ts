// Stage 3b — find meetings that exist twice in the source app (e.g. Read.ai import + manual upload of
// the same call) so every remark is counted once. Two calls are the same meeting when they
// are within a day of each other and share most of their transcript text (8-word shingles).
// The copy with more transcript is kept; the other is listed in data/duplicates.json.
import type { CallMeta } from "./pull.ts";
import type { Screen } from "./screen.ts";
import type { Segment } from "./fetch.ts";
import { path, readJson, writeJson } from "./config.ts";

const SHINGLE = 8;
const MIN_OVERLAP = 0.3; // share of the SMALLER transcript's shingles found in the other

function shingles(segs: Segment[]): Set<string> {
	const words = segs.map((s) => s.text).join(" ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ");
	const out = new Set<string>();
	for (let i = 0; i + SHINGLE <= words.length; i++) out.add(words.slice(i, i + SHINGLE).join(" "));
	return out;
}

const calls = new Map(readJson<CallMeta[]>(path("calls.json"), []).map((c) => [c.id, c]));
const kept = readJson<Screen[]>(path("screened.json"), []).filter((s) => s.relevant).map((s) => s.id);
const sh = new Map(kept.map((id) => [id, shingles(readJson<Segment[]>(path("transcripts", `${id}.json`), []))]));
const day = (id: string) => new Date(String(calls.get(id)?.recorded_at ?? 0)).getTime() / 86400000;

const dropped = new Map<string, { kept: string; overlap: number }>();
const ids = [...kept].sort();
for (let i = 0; i < ids.length; i++)
	for (let j = i + 1; j < ids.length; j++) {
		const a = ids[i], b = ids[j];
		if (dropped.has(a) || dropped.has(b) || Math.abs(day(a) - day(b)) > 1) continue;
		const A = sh.get(a)!, B = sh.get(b)!;
		const [small, big] = A.size <= B.size ? [A, B] : [B, A];
		if (small.size < 50) continue;
		let hit = 0;
		for (const s of small) if (big.has(s)) hit++;
		const overlap = hit / small.size;
		if (overlap >= MIN_OVERLAP) {
			const [keep, drop] = A.size >= B.size ? [a, b] : [b, a];
			dropped.set(drop, { kept: keep, overlap: Math.round(overlap * 100) / 100 });
		}
	}

writeJson(path("duplicates.json"), Object.fromEntries(dropped));
console.log(`dedupe: ${dropped.size} calls are second copies of another call and will not be counted`);
for (const [drop, { kept: keep, overlap }] of dropped) {
	const d = calls.get(drop), k = calls.get(keep);
	console.log(`  ${String(d?.recorded_at).slice(0, 10)} ${d?.company ?? "-"} | drop ${drop.slice(0, 8)} (${d?.source}) ← keep ${keep.slice(0, 8)} (${k?.source}) overlap ${overlap}`);
}
