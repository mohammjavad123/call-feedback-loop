// Finds a quote back in its transcript. A quote we cannot find is never shown.
import type { Segment } from "./fetch.ts";

export const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Where does this quote really occur? Exact (normalised) match near the claimed segment first, then anywhere. */
export function locateQuote(quote: string, segs: Segment[], claimed: number): number | null {
	const q = norm(quote);
	if (q.length < 8) return null;
	const near = segs.filter((s) => Math.abs(s.seq - claimed) <= 3).sort((a, b) => Math.abs(a.seq - claimed) - Math.abs(b.seq - claimed));
	for (const s of [...near, ...segs]) if (norm(s.text).includes(q)) return s.seq;
	// Quotes that span two neighbouring segments.
	for (let i = 0; i + 1 < segs.length; i++) if (norm(`${segs[i].text} ${segs[i + 1].text}`).includes(q)) return segs[i].seq;
	// Allow tiny transcription drift: ≥ 90% of the quote's word 3-grams appear in one segment window.
	const words = q.split(" ");
	if (words.length < 6) return null;
	const grams = words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(" "));
	for (const s of [...near, ...segs]) {
		const i = segs.indexOf(s);
		const win = norm(segs.slice(Math.max(0, i - 1), i + 2).map((x) => x.text).join(" "));
		if (grams.filter((g) => win.includes(g)).length / grams.length >= 0.9) return s.seq;
	}
	return null;
}
