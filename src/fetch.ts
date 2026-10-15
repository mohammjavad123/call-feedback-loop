// Stage 3 — download full transcripts, but ONLY for calls the screen kept.
import type { Screen } from "./screen.ts";
import { existsSync } from "node:fs";
import { path, readJson, writeJson } from "./config.ts";
import { ReadOnlyDb } from "./db.ts";

export type Segment = { seq: number; start_ms: number | null; text: string; who: string | null; email: string | null };

const keep = readJson<Screen[]>(path("screened.json"), []).filter((s) => s.relevant);
const todo = keep.filter((s) => !existsSync(path("transcripts", `${s.id}.json`)));
if (todo.length === 0) {
	console.log(`fetch: all ${keep.length} relevant transcripts already cached`);
} else {
	const db = await ReadOnlyDb.connect();
	try {
		for (const s of todo) {
			const segs = await db.select<Segment>(
				`select ts.sequence seq, ts.start_ms, ts.text, coalesce(sp.display_name, sp.name, ts.assembly_ai_label) who, sp.email
				from transcript_segments ts
				left join speakers sp on sp.id = ts.speaker_id
				where ts.conversation_id = $1 and ts.deleted_at is null
				order by ts.sequence`,
				[s.id],
			);
			writeJson(path("transcripts", `${s.id}.json`), segs);
		}
	} finally {
		await db.close();
	}
	console.log(`fetch: downloaded ${todo.length} transcripts (${keep.length} relevant calls total)`);
}
