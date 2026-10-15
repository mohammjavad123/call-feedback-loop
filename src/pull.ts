// Stage 1 — list the organisation's calls (metadata only, no transcripts yet).
// For each call the database also counts how many transcript segments mention the
// product, and returns up to 15 short samples, so the screen stage can decide
// relevance without us downloading every transcript.
import { path, PROFILE, VENTURE_ID, writeJson } from "./config.ts";
import { ReadOnlyDb } from "./db.ts";

// Postgres regex (case-insensitive via ~*). \m / \M = word boundaries.
const esc = (w: string) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, " ?");
export const PRODUCT_TALK = `(${[PROFILE.product, ...PROFILE.productAliases].map((w) => `\\m${esc(w)}\\M`).join("|")}|platform|the tool|dashboard|upload|transcript|insight|signal|\\mscor(e|es|ing)\\M)`;

export type CallMeta = {
	id: string;
	title: string | null;
	outcome: string | null;
	recorded_at: string | null;
	source: string | null;
	summary: string | null;
	company: string | null;
	call_type: string | null;
	segments: number;
	product_hits: number;
	hit_samples: { seq: number; text: string }[] | null;
	speakers: { name: string; email: string | null; words: number | null }[] | null;
};

const db = await ReadOnlyDb.connect();
try {
	const calls = await db.select<CallMeta>(
		`with calls as (
			select c.id, c.title, c.outcome, c.recorded_at, c.source, left(c.summary_text, 2500) summary, co.name company
			from conversations c
			left join companies co on co.id = c.primary_company_id
			where c.venture_id = $1 and c.deleted_at is null and c.is_active and c.status = 'completed'
		)
		select calls.*,
			(select ir.call_type from intelligence_runs ir
				where ir.conversation_id = calls.id and ir.deleted_at is null
				order by ir.created_at desc limit 1) call_type,
			(select count(*)::int from transcript_segments ts
				where ts.conversation_id = calls.id and ts.deleted_at is null) segments,
			(select count(*)::int from transcript_segments ts
				where ts.conversation_id = calls.id and ts.deleted_at is null and ts.text ~* $2) product_hits,
			(select json_agg(x) from (
				select ts.sequence seq, left(ts.text, 320) text from transcript_segments ts
				where ts.conversation_id = calls.id and ts.deleted_at is null and ts.text ~* $2
				order by ts.sequence limit 15) x) hit_samples,
			(select json_agg(json_build_object('name', coalesce(s.display_name, s.name), 'email', s.email, 'words', cs.word_count))
				from conversation_speakers cs join speakers s on s.id = cs.speaker_id
				where cs.conversation_id = calls.id and cs.deleted_at is null) speakers
		from calls
		order by calls.recorded_at asc nulls last`,
		[VENTURE_ID, PRODUCT_TALK],
	);
	writeJson(path("calls.json"), calls);
	const withHits = calls.filter((c) => c.product_hits > 0).length;
	console.log(`pull: ${calls.length} calls, ${withHits} mention the product at least once → data/calls.json`);
} finally {
	await db.close();
}
