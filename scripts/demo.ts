// Generates a fully synthetic dataset (fictional product, companies, people and quotes) so the
// dashboard can be explored — and screenshotted — without a database or API keys.
//   npm run demo   → demo-data/*.json → dist/dashboard.html
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "demo-data");
mkdirSync(OUT, { recursive: true });

let seed = 20261015;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const id = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("").replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");

const COMPANIES = [
	"Northwind Ventures", "Bluefin Studio", "Kestrel Labs", "Harbor & Co", "Lumen Works", "Quarry Capital", "Atlas Foundry", "Juniper Studio",
	"Ridgeline Ventures", "Sable Labs", "Orchard Collective", "Copperleaf", "Tidewater Studio", "Granite Peak", "Meridian Labs", "Foxglove Ventures",
	"Larkspur", "Halcyon Studio", "Brightwater", "Cobalt Forge", "Wildflower Labs", "Pinecrest", "Silverline Ventures", "Driftwood Studio",
	"Evergreen Labs", "Nimbus Works", "Saltmarsh", "Ironbark Ventures", "Moonrise Studio", "Kingfisher Labs", "Bramblewood", "Stonebridge",
];
const PEOPLE = ["Ava", "Liam", "Noor", "Mateo", "Sofia", "Jonas", "Priya", "Lucas", "Emma", "Yara", "Daan", "Mila", "Omar", "Lena", "Ravi", "Isla"];
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const MONTH_W = [0.05, 0.1, 0.12, 0.2, 0.16, 0.16, 0.15, 0.06];

type Kind = "problem" | "adoption_blocker" | "strength" | "request" | "context";
type T = { kind: Kind; name: string; area: string; cats: string[]; calls: number; at: [number, number]; insight: string; rec: string; quotes: string[] };
const THEMES: T[] = [
	{ kind: "problem", name: "Prospects don't see what it does in the first demo", area: "onboarding_setup", cats: ["confusion", "complaint"], calls: 30, at: [-1.2, 0.6],
		insight: "Studio prospects leave first demos unsure what the product changes for them day to day.", rec: "Open every demo with one customer's before/after story.",
		quotes: ["I still don't fully get what it does for us on a normal Monday.", "So it records the calls, and then what happens with all that?", "It looks impressive, but I couldn't explain it to my partners yet.", "What is the one thing I would stop doing if we used this?", "I need to see it on our own calls before it clicks."] },
	{ kind: "problem", name: "Uploads fail for calls the user didn't host", area: "capture_upload", cats: ["bug", "complaint"], calls: 18, at: [2.6, 2.4],
		insight: "Founders lose interviews when the call was hosted by the customer.", rec: "Accept transcript files and recordings from any host in one step.",
		quotes: ["Half my interviews are on their Zoom, so nothing gets recorded.", "The upload just spins when the call came from someone else's account.", "I had to email myself the recording and upload it three times.", "When the customer hosts, it's simply gone."] },
	{ kind: "problem", name: "Evidence grades feel like a black box", area: "scores_evidence_tiers", cats: ["confusion"], calls: 15, at: [0.4, 3.2],
		insight: "Users see grades but can't tell why a signal is strong or weak.", rec: "Show the three quotes behind every grade, one click away.",
		quotes: ["Why is this one an E3 and that one an E1? I can't tell.", "I don't trust a score I can't explain to my investor.", "The grades look precise but I don't know what they mean."] },
	{ kind: "problem", name: "Too many signals, unclear what to act on", area: "insights_signals", cats: ["complaint", "confusion"], calls: 13, at: [1.6, -0.6],
		insight: "After ten calls the signal list grows faster than users can read it.", rec: "Rank signals by decision impact and show the top three first.",
		quotes: ["There are forty signals now. Which three matter this week?", "It's a lot. I just want to know what to do next.", "Everything looks important, so nothing does."] },
	{ kind: "adoption_blocker", name: "Recording consent scares interviewees", area: "trust_privacy", cats: ["objection"], calls: 13, at: [-3.0, -1.6],
		insight: "Customers hesitate or refuse when a recorder joins the call.", rec: "Offer a consent script and a no-bot capture option.",
		quotes: ["When the bot joins, people suddenly talk like they're on the record.", "Two interviewees asked me to switch the recording off.", "In our market, recording a call is a big ask."] },
	{ kind: "adoption_blocker", name: "Teams won't share data before a pilot", area: "trust_privacy", cats: ["objection"], calls: 10, at: [-2.4, -2.8],
		insight: "Studios want a contract and a data agreement before uploading anything.", rec: "Lead with a sample workspace so value shows before data is shared.",
		quotes: ["Legal won't let us upload founder calls before there's a DPA.", "Show me on demo data first, then we talk about our own calls."] },
	{ kind: "adoption_blocker", name: "A seven-day trial is too short to judge", area: "pricing_packaging", cats: ["objection", "pricing"], calls: 8, at: [3.4, -2.6],
		insight: "Buyers say a week is not enough to see patterns across calls.", rec: "Offer a 6–8 week pilot tied to one live venture.",
		quotes: ["Seven days? We don't even have seven interviews in a week.", "We'd need a proper pilot, a couple of months, not a week."] },
	{ kind: "strength", name: "Per-call coaching changes how people interview", area: "reflections_coaching", cats: ["praise"], calls: 40, at: [0.2, -2.8],
		insight: "Founders say the per-call feedback made them ask better follow-up questions.", rec: "Protect the coaching; surface it right after each call.",
		quotes: ["The feedback after each call is honestly the best part.", "It caught me pitching too early. Twice. Fair enough.", "My questions got sharper after a week of these reflections.", "It's like having a coach listen to every interview."] },
	{ kind: "strength", name: "Live demos make studios ask for access", area: "overall_value", cats: ["praise"], calls: 22, at: [-0.6, -0.4],
		insight: "Seeing their own patterns appear live turns curiosity into requests for access.", rec: "Make the live demo on real calls the default sales motion.",
		quotes: ["Can we get this for our whole studio next month?", "That moment where it connected three calls — that sold it.", "I want my partners to see this demo."] },
	{ kind: "strength", name: "Pattern detection across calls feels like magic", area: "insights_signals", cats: ["praise"], calls: 18, at: [1.0, 1.4],
		insight: "Users value seeing the same pain show up across different customers.", rec: "Amplify cross-call patterns in the weekly summary.",
		quotes: ["It found the same complaint in six calls I'd forgotten about.", "Seeing the pattern across customers is the whole point for us."] },
	{ kind: "strength", name: "Chat over all calls saves hours of rereading", area: "chat_mcp_claude", cats: ["praise"], calls: 12, at: [3.0, 0.8],
		insight: "Asking questions across all calls replaces rereading transcripts.", rec: "Promote the chat in onboarding with three example questions.",
		quotes: ["I asked what pricing people mentioned and had it in ten seconds.", "No more scrolling through transcripts on a Sunday."] },
	{ kind: "request", name: "A proactive weekly to-do from the calls", area: "insights_signals", cats: ["feature_request"], calls: 15, at: [-1.6, 2.6],
		insight: "Users want the product to tell them what to do next, not just what was said.", rec: "Ship a Monday digest with three suggested next steps.",
		quotes: ["Just tell me on Monday what to do with all of this.", "I'd love a weekly list: who to call back, what to test next."] },
	{ kind: "request", name: "Connect CRM and email, not only calls", area: "integrations", cats: ["feature_request"], calls: 9, at: [2.2, 3.6],
		insight: "Half the customer conversation happens in email and the CRM.", rec: "Add email and CRM as sources, starting with read-only import.",
		quotes: ["Most of my follow-ups are email. Can it read those too?", "If it talked to our CRM, I'd never open the CRM again."] },
	{ kind: "request", name: "One portfolio view across all ventures", area: "studio_portfolio", cats: ["feature_request"], calls: 7, at: [-3.2, 1.2],
		insight: "Studio leads want to compare traction signals across ventures.", rec: "Add a portfolio page with one row per venture.",
		quotes: ["I run twelve ventures. Show me which ones are stuck.", "A portfolio view is what I'd pay for."] },
	{ kind: "context", name: "Used to prep the next interview", area: "overall_value", cats: ["use_case"], calls: 12, at: [-0.2, 1.8],
		insight: "Founders reread the last call's summary right before the next one.", rec: "Add a one-page prep sheet per upcoming call.",
		quotes: ["Before each call I skim what the last three people said.", "I use it as my prep sheet."] },
	{ kind: "context", name: "Compared with generic note-takers", area: "overall_value", cats: ["competitor"], calls: 10, at: [1.8, -2.0],
		insight: "Prospects compare it with meeting note-takers they already pay for.", rec: "Position on cross-call patterns, which note-takers don't do.",
		quotes: ["We already have a note-taker. What does this add?", "Our note-taker gives summaries, not patterns."] },
];
const KIND_KIND: Record<Kind, string> = { problem: "problem", adoption_blocker: "adoption_blocker", strength: "strength", request: "request", context: "context" };
const CALL_KINDS: [string, number][] = [["founder_checkin", 0.38], ["prospect_studio_fund_corporate", 0.24], ["founder_onboarding", 0.12], ["founder_recruitment", 0.14], ["existing_client", 0.07], ["partner_or_investor", 0.05]];
const weighted = <V>(pairs: [V, number][]) => { let r = rnd(); for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };

const calls: Record<string, unknown>[] = [];
const screened: Record<string, unknown>[] = [];
const items: Record<string, unknown>[] = [];
const map: Record<string, [number, number]> = {};
const themes: Record<string, unknown>[] = [];

function newCall() {
	const cid = id();
	const m = weighted(MONTHS.map((mm, i) => [mm, MONTH_W[i]] as [string, number]));
	const d = `${m}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}T${String(9 + Math.floor(rnd() * 8)).padStart(2, "0")}:00:00.000Z`;
	calls.push({ id: cid, title: "Customer call", outcome: "Customer call", recorded_at: d, company: pick(COMPANIES), segments: 120 });
	screened.push({ id: cid, call_kind: weighted(CALL_KINDS), product_talk: "substantial", relevant: true, reason: "demo" });
	return cid;
}

THEMES.forEach((t, ti) => {
	const ids: string[] = [];
	for (let c = 0; c < t.calls; c++) {
		const cid = newCall();
		const n = 1 + (rnd() < 0.35 ? 1 : 0);
		for (let k = 0; k < n; k++) {
			const iid = id().slice(0, 12);
			const team = rnd() < 0.12;
			items.push({ id: iid, call_id: cid, category: pick(t.cats), area: t.area, summary: t.insight, quote: pick(t.quotes), segment: 10 + Math.floor(rnd() * 80), found_segment: 10 + Math.floor(rnd() * 80), speaker: pick(PEOPLE), strength: 1 + Math.floor(rnd() * 3), verified: true, side: team ? "team" : "external" });
			map[iid] = [t.at[0] + gauss() * 0.42, t.at[1] + gauss() * 0.42];
			ids.push(iid);
		}
	}
	themes.push({ key: `${KIND_KIND[t.kind]}-${ti}`, name: t.name, kind: t.kind, area: t.area, insight: t.insight, recommendation: t.rec, item_ids: ids, cohesion: Math.round((0.5 + rnd() * 0.16) * 100) / 100 });
});
// background noise: remarks that belong to no theme
const NOISE = ["It's fine, I just haven't used it much this month.", "The colours in the app are nice.", "We mostly use it on Fridays.", "I forwarded the summary to my co-founder."];
for (let i = 0; i < 420; i++) {
	const cid = i % 3 === 0 ? newCall() : (calls[Math.floor(rnd() * calls.length)].id as string);
	const iid = id().slice(0, 12);
	items.push({ id: iid, call_id: cid, category: pick(["use_case", "praise", "complaint", "feature_request"]), area: pick(["overall_value", "onboarding_setup", "insights_signals"]), summary: "A one-off remark.", quote: pick(NOISE), segment: 5, found_segment: 5, speaker: pick(PEOPLE), strength: 1, verified: true, side: "external" });
	map[iid] = [gauss() * 2.4, gauss() * 2.0];
}

const write = (f: string, v: unknown) => writeFileSync(join(OUT, f), JSON.stringify(v));
write("calls.json", calls);
write("screened.json", screened);
write("items.json", items);
write("themes.json", { generated_at: "2026-10-15T09:00:00.000Z", method: { embed: "text-embedding-3-large", linkage: "average", threshold: 0.45, min_calls: 3 }, themes });
write("map.json", map);
write("duplicates.json", {});
console.log(`demo: ${calls.length} fictional calls, ${items.length} fictional quotes, ${themes.length} themes → demo-data/`);
