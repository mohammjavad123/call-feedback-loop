// Accuracy check — a human marks a fixed random sample right/wrong, so the dashboard
// can show MEASURED accuracy instead of a claim.
//   npm run check:make   → dist/check.html (30 random verified quotes, fixed seed)
//   (mark them in the browser, press "Save results" → saves check-results.json)
//   npm run check:score  → data/accuracy.json (shown on the dashboard)
import type { CallMeta } from "./pull.ts";
import type { Item } from "./extract.ts";
import type { Segment } from "./fetch.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_URL, DIST, path, PROFILE, readJson, writeJson } from "./config.ts";
import { countableItems } from "./items.ts";

export const QUESTIONS = [
	{ key: "about_vsi", q: `Is this really feedback about ${PROFILE.product} (not about the other party's own business)?` },
	{ key: "category", q: "Is the label right?" },
	{ key: "side", q: `Is 'who said it' right (${PROFILE.org} team vs outside)?` },
	{ key: "summary", q: "Does the one-line summary say what the quote says?" },
] as const;

const SIZE = Number(process.env.N ?? 30);
const SEED = Number(process.env.SEED ?? 20261014);

function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const LABEL: Record<Item["category"], string> = {
	praise: "Praise", complaint: "Complaint", bug: "Bug", confusion: "Confusion", feature_request: "Feature request",
	gap: "Gap (the product doesn't cover it)", objection: "Objection (reason not to buy/use)", pricing: "Pricing", competitor: "Competitor / other tool", use_case: "Use case (how they use it)",
};

function wilson(k: number, n: number) {
	if (n === 0) return [0, 0];
	const z = 1.96, p = k / n, d = 1 + (z * z) / n;
	const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
	return [Math.max(0, c - h), Math.min(1, c + h)];
}

const mode = process.argv[2];

if (mode === "make") {
	const items = countableItems();
	const calls = new Map(readJson<CallMeta[]>(path("calls.json"), []).map((c) => [c.id, c]));
	const rand = mulberry32(SEED);
	const pool = [...items].sort((a, b) => a.id.localeCompare(b.id));
	const sample: Item[] = [];
	while (sample.length < Math.min(SIZE, pool.length)) sample.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
	const cards = sample.map((x, i) => {
		const segs = readJson<Segment[]>(path("transcripts", `${x.call_id}.json`), []);
		const at = segs.findIndex((s) => s.seq === x.found_segment);
		const ctx = segs.slice(Math.max(0, at - 2), at + 3).map((s) => ({ who: s.who ?? "?", text: s.text, hit: s.seq === x.found_segment }));
		const c = calls.get(x.call_id);
		return { n: i + 1, id: x.id, call: x.call_id, title: c?.outcome ?? c?.title ?? "", company: c?.company ?? "", date: String(c?.recorded_at ?? "").slice(0, 10), quote: x.quote, summary: x.summary, label: LABEL[x.category], side: x.side === "external" ? `Outside ${PROFILE.org}` : `${PROFILE.org} team`, speaker: x.speaker, ctx };
	});
	writeJson(path("check-sample.json"), { seed: SEED, ids: sample.map((x) => x.id) });
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feedback Accuracy Check</title>
<style>
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--s2:#f3f2ee;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--ring:rgba(11,11,11,.1);--ok:#0ca30c;--bad:#d03b3b;--hit:#fff4c2}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--s2:#222220;--ink:#fff;--ink2:#c3c2b7;--ring:rgba(255,255,255,.1);--hit:#3a3410}}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 120px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}.lede{color:var(--ink2);margin:0 0 18px}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:14px;padding:16px;margin:14px 0}
.meta{font-size:12px;color:var(--muted)}.q{font-size:15px;margin:8px 0;font-weight:600}.ctx{background:var(--s2);border-radius:10px;padding:8px 10px;font-size:13px;color:var(--ink2);margin:8px 0}
.ctx div{margin:3px 0}.ctx .hit{background:var(--hit);color:var(--ink);border-radius:6px;padding:2px 4px}.claim{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-top:1px solid var(--ring);padding:8px 0}
.claim .v{font-size:12px;color:var(--ink2)}.yn button{border:1px solid var(--ring);background:var(--surface);color:var(--ink);border-radius:8px;padding:4px 12px;margin-left:4px;cursor:pointer}
.yn button[aria-pressed=true].y{background:var(--ok);color:#fff;border-color:var(--ok)}.yn button[aria-pressed=true].n{background:var(--bad);color:#fff;border-color:var(--bad)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--ring);padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.bar button{border:0;background:#2a78d6;color:#fff;border-radius:10px;padding:8px 16px;font-weight:600;cursor:pointer}a{color:#2a78d6}
</style></head><body><div class="wrap">
<h1>Accuracy check · ${cards.length} random quotes</h1>
<p class="lede">For each card, read the quote in its transcript context and mark each line ✓ or ✗. The highlighted line is where the quote was found. When done, press <b>Save results</b> — the file goes to Downloads; tell Claude and it scores it.</p>
<div id="cards"></div></div>
<div class="bar"><span id="progress"></span><button id="save">Save results</button><button id="copy">Copy results</button></div>
<script>
const CARDS=${JSON.stringify(cards).replace(/</g, "\\u003c")};const QS=${JSON.stringify(QUESTIONS)};const APP=${JSON.stringify(APP_URL)};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
let R={};try{R=JSON.parse(localStorage.getItem("kfl-check-${SEED}")||"{}")}catch{}
const shown={about_vsi:c=>"",category:c=>"Label: <b>"+esc(c.label)+"</b>",side:c=>"Said by: <b>"+esc(c.side)+"</b> ("+esc(c.speaker)+")",summary:c=>"Summary: "+esc(c.summary)};
function draw(){document.getElementById("cards").innerHTML=CARDS.map(c=>'<div class="card"><div class="meta">#'+c.n+' · '+esc(c.company||"–")+' · '+esc(c.date)+' · '+esc(c.title)+' · <a href="'+APP+'/conversations/'+c.call+'" target="_blank" rel="noopener">open call ↗</a></div><div class="q">“'+esc(c.quote)+'”</div><div class="ctx">'+c.ctx.map(s=>'<div class="'+(s.hit?"hit":"")+'"><b>'+esc(s.who)+':</b> '+esc(s.text)+'</div>').join("")+'</div>'+QS.map(q=>{const v=(R[c.id]||{})[q.key];return '<div class="claim"><div>'+esc(q.q)+'<div class="v">'+shown[q.key](c)+'</div></div><div class="yn"><button class="y" data-id="'+c.id+'" data-k="'+q.key+'" data-v="1" aria-pressed="'+(v===1)+'">✓</button><button class="n" data-id="'+c.id+'" data-k="'+q.key+'" data-v="0" aria-pressed="'+(v===0)+'">✗</button></div></div>'}).join("")+'</div>').join("");
const done=CARDS.filter(c=>QS.every(q=>(R[c.id]||{})[q.key]!==undefined)).length;document.getElementById("progress").textContent=done+" / "+CARDS.length+" cards complete";}
document.addEventListener("click",e=>{const b=e.target.closest("button[data-id]");if(!b)return;(R[b.dataset.id]??={})[b.dataset.k]=Number(b.dataset.v);try{localStorage.setItem("kfl-check-${SEED}",JSON.stringify(R))}catch{};const y=scrollY;draw();scrollTo(0,y)});
const payload=()=>JSON.stringify({seed:${SEED},results:R});
document.getElementById("save").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([payload()],{type:"application/json"}));a.download="check-results.json";a.click()};
document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(payload()).then(()=>alert("Copied — paste it to Claude"));
draw();
</script></body></html>`;
	mkdirSync(DIST, { recursive: true });
	writeFileSync(join(DIST, "check.html"), html);
	console.log(`check: dist/check.html with ${cards.length} random verified quotes (seed ${SEED})`);
}

if (mode === "score") {
	const file = process.env.RESULTS ?? join(process.env.HOME ?? "", "Downloads/check-results.json");
	if (!existsSync(file)) throw new Error(`no results file at ${file}`);
	const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: Record<string, Record<string, number>> };
	const { ids } = readJson<{ ids: string[] }>(path("check-sample.json"), { ids: [] });
	const out: Record<string, { right: number; marked: number; pct: number; ci95: [number, number] }> = {};
	for (const { key } of QUESTIONS) {
		const marks = ids.map((id) => results[id]?.[key]).filter((v) => v === 0 || v === 1);
		const right = marks.filter((v) => v === 1).length;
		const [lo, hi] = wilson(right, marks.length);
		out[key] = { right, marked: marks.length, pct: Math.round((100 * right) / Math.max(1, marks.length)), ci95: [Math.round(lo * 100), Math.round(hi * 100)] };
	}
	const allRight = ids.filter((id) => QUESTIONS.every(({ key }) => results[id]?.[key] === 1)).length;
	writeJson(path("accuracy.json"), { checked_at: new Date().toISOString(), sample: ids.length, fully_right: allRight, per_question: out });
	console.log("accuracy:", JSON.stringify(out), `fully right ${allRight}/${ids.length}`);
}
