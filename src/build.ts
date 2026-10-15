// Stage 6 — build the dashboard: one self-contained HTML file (no network needed).
// It contains founders' and prospects' quotes, so it stays local (dist/ is gitignored).
import type { CallMeta } from "./pull.ts";
import type { Screen } from "./screen.ts";
import type { Item } from "./extract.ts";
import type { Theme } from "./themes.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_URL, DIST, path, PROFILE, readJson, ROOT, writeJson } from "./config.ts";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
import { MODEL_NAME } from "./llm.ts";
import { countableItems } from "./items.ts";
import { writeFileSync, mkdirSync } from "node:fs";

type Audience = "founders" | "buyers" | "candidates" | "team" | "other";

function audience(kind: Screen["call_kind"] | undefined, side: Item["side"]): Audience {
	if (side !== "external") return "team";
	if (kind === "founder_checkin" || kind === "founder_onboarding") return "founders";
	if (kind === "founder_recruitment") return "candidates";
	if (kind === "prospect_studio_fund_corporate" || kind === "existing_client" || kind === "partner_or_investor") return "buyers";
	return "other";
}

const calls = readJson<CallMeta[]>(path("calls.json"), []);
const screens = new Map(readJson<Screen[]>(path("screened.json"), []).map((s) => [s.id, s]));
const items = readJson<Item[]>(path("items.json"), []);
const { generated_at, themes, method } = readJson<{ generated_at: string; themes: Theme[]; method?: { embed: string; threshold: number; min_calls: number } }>(path("themes.json"), { generated_at: new Date().toISOString(), themes: [] });
type Accuracy = { sample: number; fully_right: number; per_question: Record<string, { right: number; marked: number; pct: number; ci95: [number, number] }> };
const accuracy = readJson<Accuracy | null>(path("accuracy.json"), null);
const callById = new Map(calls.map((c) => [c.id, c]));
const mapXY = readJson<Record<string, [number, number]>>(path("map.json"), {});

const themeOf = new Map<string, string>();
for (const t of themes) for (const id of t.item_ids) themeOf.set(id, t.key);

const duplicates = readJson<Record<string, unknown>>(path("duplicates.json"), {});
const verified = countableItems();
const rows = verified.map((x) => {
	const c = callById.get(x.call_id);
	const d = String(c?.recorded_at ?? "");
	return {
		id: x.id,
		c: x.call_id,
		d,
		m: d.slice(0, 7),
		co: c?.company ?? "",
		cat: x.category,
		area: x.area,
		s: x.summary,
		q: x.quote,
		seg: x.found_segment,
		sp: x.speaker,
		side: x.side,
		st: x.strength,
		aud: audience(screens.get(x.call_id)?.call_kind, x.side),
		th: themeOf.get(x.id) ?? null,
		xy: mapXY[x.id] ?? null,
	};
});

const monthsSet = [...new Set(rows.map((r) => r.m).filter(Boolean))].sort();
const months: string[] = [];
if (monthsSet.length) {
	const [y0, m0] = monthsSet[0].split("-").map(Number);
	const [y1, m1] = monthsSet[monthsSet.length - 1].split("-").map(Number);
	for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
}

const data = {
	generated_at,
	app_url: APP_URL,
	labels: { org: PROFILE.org, product: PROFILE.brand },
	months,
	scope: {
		calls_total: calls.length,
		calls_relevant: [...screens.values()].filter((s) => s.relevant).length,
		items_total: items.length,
		items_verified: verified.length,
		duplicate_calls: Object.keys(duplicates).length,
	},
	accuracy,
	themes: themes.map(({ item_ids: _ids, ...t }) => t),
	items: rows,
};

const css = readFileSync(join(ROOT, "src/dashboard/style.css"), "utf8");
const js = readFileSync(join(ROOT, "src/dashboard/app.js"), "utf8");
// Embed data safely inside <script>: never let a quote close the tag.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const asOf = new Date(generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const found = items.filter((x) => x.verified).length;
const pct = Math.round((100 * found) / Math.max(1, items.length));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PROFILE.brand)} Feedback Loop</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>${css}</style>
</head>
<body>
<div class="hero"><span class="aqua" aria-hidden="true"></span><div class="wrap">
	<div class="top">
		<div class="brand"><span class="mark" aria-hidden="true"></span>${esc(PROFILE.brand)} · Product feedback loop <span class="badge">as of ${asOf}</span></div>
		<button class="icon-btn" id="theme" aria-label="Switch light or dark">◐</button>
	</div>
	<h1>${esc(PROFILE.dashboardTitle)}</h1>
	<p class="lede">Every ${esc(PROFILE.org)} call screened; ${data.scope.calls_relevant} calls about the product read in full. Every line rests on a word-for-word quote found back in its transcript (${pct}% of ${items.length.toLocaleString()} extracted); meetings stored twice are counted once.</p>
	<div class="bigstats">
		<div class="bigstat"><div class="v" data-count="${data.scope.calls_total}">${data.scope.calls_total}</div><div class="k">calls screened</div></div>
		<div class="bigstat"><div class="v" data-count="${data.scope.calls_relevant - data.scope.duplicate_calls}">${data.scope.calls_relevant - data.scope.duplicate_calls}</div><div class="k">unique meetings about ${esc(PROFILE.brand)}</div></div>
		<div class="bigstat"><div class="v" data-count="${verified.length}">${verified.length.toLocaleString()}</div><div class="k">verified quotes</div></div>
		<div class="bigstat"><div class="v" data-count="${new Set(rows.map((r) => r.co).filter(Boolean)).size}">${new Set(rows.map((r) => r.co).filter(Boolean)).size}</div><div class="k">companies in these calls</div></div>
	</div>
</div></div>

<div class="filters"><div class="wrap">
	<div><span class="flabel">Who</span><span class="seg" id="f-aud">
		<button data-v="external" aria-pressed="true">Outside ${esc(PROFILE.org)}</button><button data-v="all" aria-pressed="false">Everyone</button><button data-v="founders" aria-pressed="false">Founders using ${esc(PROFILE.brand)}</button><button data-v="buyers" aria-pressed="false">Buyers &amp; partners</button><button data-v="candidates" aria-pressed="false">Founder candidates</button><button data-v="team" aria-pressed="false">${esc(PROFILE.org)} team</button></span></div>
	<div><span class="flabel">What</span><span class="seg" id="f-kind">
		<button data-v="all" aria-pressed="true">All</button><button data-v="problem" aria-pressed="false">Problems</button><button data-v="strength" aria-pressed="false">Strengths</button><button data-v="request" aria-pressed="false">Requests</button><button data-v="context" aria-pressed="false">Context</button></span></div>
	<div><span class="flabel">When</span><span class="seg" id="f-period">
		<button data-v="all" aria-pressed="true">All time</button><button data-v="90" aria-pressed="false">90 days</button><button data-v="30" aria-pressed="false">30 days</button></span></div>
	<input class="search" id="f-q" type="search" placeholder="Search quotes, companies…" aria-label="Search quotes">
</div></div>

<main class="wrap">
	<section id="kpis" hidden></section>
	<div class="card mapcard"><div class="maphead"><div><h2>Embedding map · every quote, placed by meaning</h2>
		<div class="sub">${verified.length.toLocaleString()} verified quotes · OpenAI text-embedding-3-large → UMAP (cosine, seed 42) · close dots = people saying the same thing · hover a dot to read it, click to open its theme</div></div>
		</div>
		<div class="mapmode" id="mapmode"><button data-v="all" aria-pressed="true">All clusters</button><button data-v="problem" aria-pressed="false" class="bad">⚠ Where customers struggle</button><button data-v="strength" aria-pressed="false">What they love</button><button data-v="request" aria-pressed="false">What they ask for</button></div>
		<div class="mapwrap"><div class="map" id="map"><canvas id="mapc"></canvas></div><div class="maplist"><div class="ml-h">Top clusters · calls</div><div id="maplist"></div></div></div></div>
	<section class="headlines" id="headlines" aria-label="Headlines"></section>
	<div class="card"><h2>Cluster quality · every theme the model found</h2><div class="sub">Each bubble = one cluster (theme) · across = cohesion (how alike its quotes are) · up = how many calls raised it · size = quotes · click a bubble for its quotes</div>
		<div class="legend"><span><i style="background:var(--problem)"></i>Problem / blocker</span><span><i style="background:var(--strength)"></i>Strength</span><span><i style="background:var(--request)"></i>Request</span></div>
		<div class="tree" id="tree"></div></div>
	<div class="two" style="margin-top:16px">
		<div class="card pulse"><h2>Pulse</h2><div class="sub">Quotes per month · praise above the line, problems below</div>
			<div class="legend"><span><i style="background:var(--strength)"></i>Praise</span><span><i style="background:var(--problem)"></i>Problems</span></div>
			<div id="pulse"></div></div>
		<div class="card"><h2>Where it hurts, where it helps</h2><div class="sub">Problem vs praise quotes per product area</div><div id="div"></div></div>
	</div>
	<div class="section-title"><h2>All themes</h2><span class="sub" id="board-sub"></span></div>
	<div class="legend"><span><i style="background:var(--problem)"></i>! Problem · ⛔ Blocker</span><span><i style="background:var(--strength)"></i>✓ Strength</span><span><i style="background:var(--request)"></i>+ Request</span><span style="margin-left:12px">Bar under each chart = who said it:</span><span><i style="background:var(--a1)"></i>Founders</span><span><i style="background:var(--a2)"></i>Buyers &amp; partners</span><span><i style="background:var(--a3)"></i>Candidates</span><span><i style="background:var(--a4)"></i>${esc(PROFILE.org)} team</span></div>
	<div id="board"></div>
	<div id="heat" hidden></div><div id="voices" hidden></div>
	<div class="section-title"><h2>How this is made</h2></div>
	<div class="card method"><ol>
		<li><b>Pull</b> — SELECT-only read of ${esc(PROFILE.org)}'s calls (every query in its own read-only transaction; a write probe must be refused before anything runs).</li>
		<li><b>Screen</b> — the LLM reads each call's summary and product-word samples and keeps only calls where people talk about ${esc(PROFILE.product)} itself. Hiring interviews drop out.</li>
		<li><b>Read</b> — full transcripts are downloaded for kept calls only; the LLM extracts every piece of product feedback with a verbatim quote and segment number.</li>
		<li><b>Check</b> — code looks each quote up in the transcript. Not found → dropped.</li>
		<li><b>De-duplicate</b> — ${Object.keys(duplicates).length} meetings exist twice in the source app (e.g. Read.ai import + manual upload). Same day + ≥30% shared transcript text = same meeting; only one copy is counted.</li>
		<li><b>Group</b> — machine learning, not the LLM: each quote's topic (names removed) is turned into an embedding (${method?.embed ?? "OpenAI"}), then grouped by average-linkage clustering at similarity ≥ ${method?.threshold ?? "–"}, separately for problems, blockers, strengths, requests and context. A theme needs ≥ ${method?.min_calls ?? 2} different calls. Same data → same themes → same numbers. The LLM only writes each theme's name.</li>
		<li><b>Measure</b> — ${accuracy ? `a person checked ${accuracy.sample} random quotes: ${Object.entries(accuracy.per_question).map(([k, v]) => `${k.replace("_", " ")} ${v.right}/${v.marked}`).join(" · ")}.` : "a random sample of 30 quotes is checked by hand (pending)."}</li>
	</ol></div>
	<footer>Built ${new Date().toLocaleString("en-GB")} · ${data.scope.calls_total} calls screened · model ${MODEL_NAME} · local file, contains quotes from founders and prospects — do not forward.</footer>
</main>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-label="Theme detail">
	<header><button class="icon-btn close" id="d-close" aria-label="Close">✕</button><div id="d-head"></div></header>
	<div class="body" id="d-body"></div>
</aside>
<div class="tip" id="tip" role="tooltip"></div>
<script>window.__DATA__ = ${json};</script>
<script>${js}</script>
</body>
</html>`;

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, "dashboard.html"), html);
writeJson(path("dashboard-data.json"), data);
console.log(`build: dist/dashboard.html — ${themes.length} themes, ${rows.length} verified quotes, ${rows.filter((r) => r.th).length} in a theme`);
