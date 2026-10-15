// Client side of the feedback dashboard. All numbers are counted here from the
// embedded items, so every filter recomputes everything from the same rows.
(() => {
	const D = window.__DATA__;
	const $ = (s, el = document) => el.querySelector(s);
	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
	const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

	const KIND = {
		problem: { label: "Problem", icon: "!", color: "var(--problem)" },
		adoption_blocker: { label: "Blocker", icon: "⛔", color: "var(--problem)" },
		strength: { label: "Strength", icon: "✓", color: "var(--strength)" },
		request: { label: "Request", icon: "+", color: "var(--request)" },
		context: { label: "Context", icon: "i", color: "var(--muted)" },
	};
	const CAT = {
		praise: "Praise", complaint: "Complaint", bug: "Bug", confusion: "Confusion", feature_request: "Feature request",
		gap: "Gap", objection: "Objection", pricing: "Pricing", competitor: "Competitor", use_case: "Use case",
	};
	const NEG = new Set(["complaint", "bug", "confusion", "objection", "gap"]);
	const AREA = {
		capture_upload: "Capture & upload", transcription_speakers: "Transcripts & speakers", reflections_coaching: "Reflections & coaching",
		insights_signals: "Insights & signals", scores_evidence_tiers: "Scores & evidence tiers", context_canvas: "Context & canvas",
		threads_companies: "Threads & companies", chat_mcp_claude: "Chat & Claude", integrations: "Integrations",
		onboarding_setup: "Onboarding & setup", studio_portfolio: "Studio portfolio", pricing_packaging: "Pricing & packaging",
		trust_privacy: "Trust & privacy", performance_reliability: "Speed & reliability", overall_value: "Overall value",
	};
	const AUD = { founders: `Founders using ${D.labels.product}`, buyers: "Buyers & partners", candidates: "Founder candidates", team: `${D.labels.org} team`, other: "Other" };

	const state = { aud: "external", kind: "all", period: "all", q: "", all: false };
	const themesByKey = new Map(D.themes.map((t) => [t.key, t]));
	const now = new Date(D.generated_at).getTime();
	const DAY = 86400000;

	// ---------- tooltip ----------
	const tip = $("#tip");
	document.addEventListener("pointermove", (e) => {
		const el = e.target.closest("[data-tip]");
		if (!el) return tip.classList.remove("on");
		tip.innerHTML = el.getAttribute("data-tip");
		const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
		const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
		tip.style.left = `${x}px`;
		tip.style.top = `${y}px`;
		tip.classList.add("on");
	});

	// ---------- filters ----------
	function filtered() {
		const q = state.q.trim().toLowerCase();
		return D.items.filter((it) => {
			if (state.aud === "external" ? it.side !== "external" : state.aud !== "all" && it.aud !== state.aud) return false;
			if (state.period !== "all" && now - new Date(it.d).getTime() > Number(state.period) * DAY) return false;
			if (state.kind !== "all") {
				const t = it.th && themesByKey.get(it.th);
				if (!t || (state.kind === "problem" ? !["problem", "adoption_blocker"].includes(t.kind) : t.kind !== state.kind)) return false;
			}
			if (q && !`${it.s} ${it.q} ${it.co} ${it.sp}`.toLowerCase().includes(q)) return false;
			return true;
		});
	}

	function bindSeg(id, key) {
		const el = document.getElementById(id);
		el.addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b) return;
			state[key] = b.dataset.v;
			for (const x of el.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
			render();
		});
	}
	bindSeg("f-aud", "aud");
	bindSeg("f-kind", "kind");
	bindSeg("f-period", "period");
	$("#f-q").addEventListener("input", (e) => {
		state.q = e.target.value;
		render();
	});

	// ---------- theme toggle ----------
	const root = document.documentElement;
	try {
		const saved = localStorage.getItem("kfl-theme");
		if (saved) root.dataset.theme = saved;
	} catch {}
	$("#theme").addEventListener("click", () => {
		const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
		root.dataset.theme = dark ? "light" : "dark";
		try {
			localStorage.setItem("kfl-theme", root.dataset.theme);
		} catch {}
	});

	// ---------- aggregation ----------
	// Only real company names count as companies; calls without one are counted as calls, never as extra companies.
	const companyOf = (it) => it.co || null;
	const countCos = (items) => new Set(items.map(companyOf).filter(Boolean)).size;
	function themeStats(items) {
		const by = new Map();
		for (const it of items) {
			if (!it.th) continue;
			let s = by.get(it.th);
			if (!s) by.set(it.th, (s = { items: [], cos: new Set(), calls: new Set(), ext: 0, last: "", months: new Map() }));
			s.items.push(it);
			if (it.co) s.cos.add(it.co);
			s.calls.add(it.c);
			if (it.side === "external") s.ext++;
			if (it.d > s.last) s.last = it.d;
			s.months.set(it.m, (s.months.get(it.m) ?? 0) + 1);
		}
		return [...by.entries()]
			.map(([key, s]) => ({ t: themesByKey.get(key), ...s }))
			.filter((x) => x.t)
			.sort((a, b) => b.calls.size - a.calls.size || b.cos.size - a.cos.size || b.items.length - a.items.length);
	}

	function sparkline(months, color) {
		const w = 96, h = 26, p = 3;
		const vals = D.months.map((m) => months.get(m) ?? 0);
		const max = Math.max(1, ...vals);
		const step = (w - 2 * p) / Math.max(1, vals.length - 1);
		const pts = vals.map((v, i) => [p + i * step, h - p - (v / max) * (h - 2 * p)]);
		const line = pts.map((pt, i) => `${i ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join("");
		const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${h - p}L${p},${h - p}Z`;
		const dots = pts
			.map((pt, i) => `<rect x="${(pt[0] - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}" fill="transparent" data-tip="${monthLabel(D.months[i])}: <b>${vals[i]}</b>"></rect>`)
			.join("");
		const lastPt = pts[pts.length - 1];
		return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
			<path d="${area}" fill="${color}" opacity="0.12"></path>
			<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
			<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2.5" fill="${color}"></circle>${dots}</svg>`;
	}

	const kindChip = (k) => `<span class="chip"><b style="background:${KIND[k].color}"></b>${KIND[k].icon} ${KIND[k].label}</span>`;

	// ---------- renderers ----------
	function renderKpis(items) {
		const calls = new Set(items.map((x) => x.c));
		const cosN = countCos(items);
		const pos = items.filter((x) => x.cat === "praise").length;
		const neg = items.filter((x) => NEG.has(x.cat)).length;
		const req = items.filter((x) => x.cat === "feature_request").length;
		const recent = items.filter((x) => now - new Date(x.d).getTime() <= 30 * DAY).length;
		const tot = Math.max(1, pos + neg + req);
		$("#kpis").innerHTML = `
			<div class="tile"><div class="k">Calls with product talk</div><div class="v">${calls.size}</div><div class="s">of ${D.scope.calls_total} calls read</div></div>
			<div class="tile"><div class="k">Feedback quotes</div><div class="v">${items.length.toLocaleString()}</div><div class="s">${D.accuracy ? `checked by hand: ${D.accuracy.fully_right}/${D.accuracy.sample} fully right` : "every quote found in its transcript"}</div></div>
			<div class="tile"><div class="k">Companies heard from</div><div class="v">${cosN}</div><div class="s">named companies only</div></div>
			<div class="tile"><div class="k">Problems · praise · requests</div><div class="v">${neg} · ${pos} · ${req}</div>
				<div class="ratio" role="img" aria-label="${neg} problems, ${pos} praise, ${req} requests">
					<span style="flex:${neg / tot};background:var(--problem)"></span><span style="flex:${pos / tot};background:var(--strength)"></span><span style="flex:${req / tot};background:var(--request)"></span></div></div>
			<div class="tile"><div class="k">Heard in the last 30 days</div><div class="v">${recent}</div><div class="s">quotes since ${fmtDate(now - 30 * DAY)}</div></div>`;
	}

	// The most telling outside quote of a theme: strongest, then shortest readable, then newest.
	function bestQuote(items) {
		const dutch = (q) => (q.toLowerCase().match(/\b(de|het|een|ik|dat|niet|maar|wij|je|wel|ook|zijn|voor|met|dan)\b/g) ?? []).length >= 3;
		const pool = items.filter((x) => x.side === "external" && x.q.length >= 40 && x.q.length <= 220 && !dutch(x.q));
		const list = pool.length ? pool : items;
		return [...list].sort((a, b) => b.st - a.st || (a.d < b.d ? 1 : -1))[0];
	}

	function squarify(data, x, y, w, h) {
		const out = [];
		const total = data.reduce((s, d) => s + d.v, 0) || 1;
		let rest = data.map((d) => ({ ...d, a: (d.v * w * h) / total }));
		const worst = (row, s) => {
			const sum = row.reduce((t, d) => t + d.a, 0), mx = Math.max(...row.map((d) => d.a)), mn = Math.min(...row.map((d) => d.a));
			return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
		};
		while (rest.length) {
			const s = Math.min(w, h);
			let row = [], best = Infinity;
			while (rest.length) {
				const cand = [...row, rest[0]], r = worst(cand, s);
				if (row.length && r > best) break;
				row = cand; best = r; rest = rest.slice(1);
			}
			const sum = row.reduce((t, d) => t + d.a, 0);
			if (w >= h) {
				const cw = sum / h; let cy = y;
				for (const d of row) { const ch = d.a / cw; out.push({ ...d, x, y: cy, w: cw, h: ch }); cy += ch; }
				x += cw; w -= cw;
			} else {
				const rh = sum / w; let cx = x;
				for (const d of row) { const cw = d.a / rh; out.push({ ...d, x: cx, y, w: cw, h: rh }); cx += cw; }
				y += rh; h -= rh;
			}
		}
		return out;
	}

	function renderTree(items) {
		const el = $("#tree");
		const rows = themeStats(items).filter((r) => r.t.kind !== "context" && r.t.cohesion);
		if (!rows.length) return (el.innerHTML = `<div class="empty">No clusters match these filters.</div>`);
		const W = Math.max(320, el.clientWidth), H = el.clientHeight, L = 54, R = 20, T = 18, B = 42;
		const cx = rows.map((r) => r.t.cohesion), cyv = rows.map((r) => r.calls.size);
		const x0 = Math.min(...cx) - 0.01, x1 = Math.max(...cx) + 0.01, y1 = Math.max(...cyv) * 1.08;
		const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), sy = (v) => T + (H - T - B) * (1 - Math.sqrt(v / y1));
		const rad = (n) => 3 + Math.sqrt(n) * 1.9;
		let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Clusters by cohesion and calls">`;
		for (const t of [1, 3, 5, 10, 20, 40, 60].filter((t) => t <= y1)) svg += `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--grid)"></line><text x="${L - 8}" y="${sy(t) + 4}" text-anchor="end" class="ax">${t}</text>`;
		for (let v = Math.ceil(x0 * 20) / 20; v <= x1; v += 0.05) svg += `<text x="${sx(v)}" y="${H - B + 18}" text-anchor="middle" class="ax">${v.toFixed(2)}</text>`;
		svg += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" class="ax">cohesion → (average cosine similarity inside the cluster: tighter = more alike)</text>`;
		svg += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="ax">calls ↑ (√ scale)</text>`;
		const order = [...rows].sort((a, b) => b.items.length - a.items.length);
		for (const r of order) {
			const c = KIND[r.t.kind].color;
			svg += `<circle class="bub" data-key="${esc(r.t.key)}" cx="${sx(r.t.cohesion)}" cy="${sy(r.calls.size)}" r="${rad(r.items.length)}" fill="${c}" fill-opacity="0.28" stroke="${c}" stroke-width="1.2"
				data-tip="<b>${esc(r.t.name)}</b><br>${KIND[r.t.kind].label} · ${r.calls.size} calls · ${r.items.length} quotes · cohesion ${r.t.cohesion}"></circle>`;
		}
		const placed = [];
		for (const r of rows.slice(0, 12)) {
			const x = sx(r.t.cohesion) + rad(r.items.length) + 5, y = sy(r.calls.size) + 4, w = 7 * Math.min(40, r.t.name.length);
			if (placed.some((p) => Math.abs(p[1] - y) < 15 && x < p[0] + p[2] && x + w > p[0])) continue;
			placed.push([x, y, w]);
			svg += `<text x="${x}" y="${y}" class="blab">${esc(r.t.name.length > 40 ? r.t.name.slice(0, 38) + "…" : r.t.name)}</text>`;
		}
		el.innerHTML = svg + "</svg>";
	}

	function renderPulse(items) {
		const by = new Map(D.months.map((m) => [m, { pos: 0, neg: 0, req: 0 }]));
		for (const it of items) {
			const b = by.get(it.m);
			if (!b) continue;
			if (it.cat === "praise") b.pos++;
			else if (NEG.has(it.cat)) b.neg++;
			else if (it.cat === "feature_request") b.req++;
		}
		const W = 680, H = 300, padX = 10, mid = H / 2, top = 26, bot = 30;
		const vals = [...by.values()];
		const max = Math.max(1, ...vals.map((v) => Math.max(v.pos, v.neg)));
		const step = (W - 2 * padX) / D.months.length;
		const bw = Math.min(40, step * 0.55);
		const sc = (v) => ((mid - top) * v) / max;
		let svg = `<svg viewBox="0 0 ${W} ${H + 4}" role="img" aria-label="Praise and problem quotes per month">
			<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--axis)" stroke-width="1"></line>`;
		D.months.forEach((m, i) => {
			const v = by.get(m), cx = padX + step * i + step / 2, hp = sc(v.pos), hn = sc(v.neg);
			svg += `<g data-tip="<b>${monthLabel(m)}</b><br>${v.pos} praise · ${v.neg} problems · ${v.req} requests">
				<rect x="${cx - step / 2}" y="0" width="${step}" height="${H}" fill="transparent"></rect>
				${hp ? `<path d="M${cx - bw / 2},${mid - 1} v${-(hp - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${hp - 4} z" fill="var(--strength)"></path>` : ""}
				${hn ? `<path d="M${cx - bw / 2},${mid + 1} v${hn - 4} q0,4 4,4 h${bw - 8} q4,0 4,-4 v${-(hn - 4)} z" fill="var(--problem)"></path>` : ""}
				${v.pos ? `<text class="vlab" x="${cx}" y="${mid - hp - 6}" text-anchor="middle">${v.pos}</text>` : ""}
				${v.neg ? `<text class="vlab" x="${cx}" y="${mid + hn + 14}" text-anchor="middle">${v.neg}</text>` : ""}
				<text x="${cx}" y="${H + 2}" text-anchor="middle">${monthLabel(m)}</text></g>`;
		});
		$("#pulse").innerHTML = svg + "</svg>";
	}

	// ---------- embedding map (canvas) ----------
	const mapEl = $("#map"), cv = $("#mapc");
	let mapPts = [];
	const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
	const groupOf = (cat) => (NEG.has(cat) ? "problem" : cat === "praise" ? "strength" : cat === "feature_request" ? "request" : "context");
	function renderMap(items) {
		const W = mapEl.clientWidth, H = mapEl.clientHeight, dpr = window.devicePixelRatio || 1;
		cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
		const g = cv.getContext("2d");
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, W, H);
		const all = D.items.filter((x) => x.xy);
		const xs = all.map((x) => x.xy[0]), ys = all.map((x) => x.xy[1]);
		const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
		const pad = 28;
		const sx = (v) => pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad), sy = (v) => pad + ((v - y0) / (y1 - y0)) * (H - 2 * pad);
		const show = new Set(items.map((x) => x.id));
		// 8 clearly different hues, same in every view; numbers are the second cue
		const PALETTE = ["#ffb347", "#00eaff", "#ff3d9e", "#00ffa0", "#d080ff", "#1e90ff", "#b6ff3c", "#ff3838"];
		const rows = themeStats(items).filter((r) => r.t.kind !== "context").slice(0, 8);
		const med = (arr) => [...arr].sort((p, q) => p - q)[Math.floor(arr.length / 2)];
		const clusters = rows
			.map((r, i) => ({ r, c: PALETTE[i], P: r.items.filter((x) => x.xy).map((x) => [sx(x.xy[0]), sy(x.xy[1])]) }))
			.filter((k) => k.P.length >= 3)
			.map((k) => {
				// densest dot = the one with most neighbours within 40px → the cluster's centre
				let best = k.P[0], bn = -1;
				for (const p of k.P) {
					let n = 0;
					for (const q of k.P) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < 1600) n++;
					if (n > bn) { bn = n; best = p; }
				}
				const byDist = k.P.map((p) => [p, (p[0] - best[0]) ** 2 + (p[1] - best[1]) ** 2]).sort((u, v) => u[1] - v[1]);
				const cut = Math.max(3, Math.ceil(k.P.length * 0.75));
				return { ...k, cx: best[0], cy: best[1], core: byDist.slice(0, cut).map((x) => x[0]), stray: byDist.slice(cut).map((x) => x[0]) };
			});
		// push markers that sit on top of each other apart (min 34px between centres)
		for (let pass = 0; pass < 20; pass++)
			for (let i = 0; i < clusters.length; i++)
				for (let j = i + 1; j < clusters.length; j++) {
					const A = clusters[i], B = clusters[j], dx = B.cx - A.cx, dy = B.cy - A.cy, d = Math.hypot(dx, dy) || 0.01;
					if (d >= 34) continue;
					const push = (34 - d) / 2, ux = dx / d, uy = dy / d;
					A.cx -= ux * push; A.cy -= uy * push; B.cx += ux * push; B.cy += uy * push;
				}
		// short labels, placed beside the marker without overlapping each other or other markers
		g.font = "600 12px " + css("--sans");
		const placed = clusters.map((k) => [k.cx - 16, k.cy - 16, 32, 32]);
		for (const k of clusters) {
			const name = k.r.t.name.length > 30 ? k.r.t.name.slice(0, 28) + "…" : k.r.t.name;
			const w = g.measureText(name).width + 18, h = 24;
			const tries = [[20, -12], [-w - 20, -12], [-w / 2, 20], [-w / 2, -44], [20, 16], [-w - 20, 16], [20, -40], [-w - 20, -40]];
			let pos = null;
			for (const [dx, dy] of tries) {
				const bx = Math.min(W - w - 6, Math.max(6, k.cx + dx)), by = Math.min(H - h - 6, Math.max(6, k.cy + dy));
				if (!placed.some((b) => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + b[3] && by + h > b[1])) { pos = [bx, by]; break; }
			}
			if (pos) { placed.push([pos[0], pos[1], w, h]); k.label = { x: pos[0], y: pos[1], w, h, name }; }
		}
		let seed = 7;
		const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		scene = { g, W, H, clusters, stars: all.map((x) => ({ x: sx(x.xy[0]), y: sy(x.xy[1]), r: show.has(x.id) ? 1.5 : 1, ph: rnd() * 6.28 })) };
		mapPts = items.filter((x) => x.xy).map((x) => ({ x: sx(x.xy[0]), y: sy(x.xy[1]), it: x }));
		$("#maplist").innerHTML = clusters
			.map((k, i) => `<button class="ml-row" data-key="${esc(k.r.t.key)}" style="--c:${k.c}"><span class="ml-n">${i + 1}</span><span class="ml-name">${esc(k.r.t.name)}<small>${KIND[k.r.t.kind].label} · ${k.r.items.length} quotes</small></span><span class="ml-c">${k.r.calls.size}</span></button>`)
			.join("");
		for (const b of document.querySelectorAll("#mapmode button")) b.setAttribute("aria-pressed", String(b.dataset.v === state.kind));
		drawScene(performance.now());
		if (!animating && !matchMedia("(prefers-reduced-motion: reduce)").matches) { animating = true; requestAnimationFrame(loop); }
	}
	let scene = null, animating = false, lastFrame = 0;
	function loop(t) {
		if (t - lastFrame > 33) { lastFrame = t; drawScene(t); }
		requestAnimationFrame(loop);
	}
	function drawScene(t) {
		if (!scene) return;
		const { g, W, H, clusters, stars } = scene;
		g.clearRect(0, 0, W, H);
		g.globalCompositeOperation = "source-over";
		g.fillStyle = "#4a4e68";
		for (const s of stars) { g.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.0012 + s.ph)); g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); }
		g.globalCompositeOperation = "lighter";
		clusters.forEach((k, i) => {
			const breathe = 0.75 + 0.25 * Math.sin(t * 0.0016 + i * 0.9);
			const rr = 20 + 4 * breathe;
			for (const [px, py] of k.core) {
				const grd = g.createRadialGradient(px, py, 0, px, py, rr);
				grd.addColorStop(0, k.c + "2a");
				grd.addColorStop(1, k.c + "00");
				g.globalAlpha = breathe;
				g.fillStyle = grd;
				g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
			}
			g.globalAlpha = 1;
			g.fillStyle = k.c;
			g.shadowColor = k.c;
			g.shadowBlur = 6 + 6 * breathe;
			for (const [px, py] of k.core) { g.beginPath(); g.arc(px, py, 2.7, 0, 7); g.fill(); }
			g.shadowBlur = 0;
			g.globalAlpha = 0.35;
			for (const [px, py] of k.stray) { g.beginPath(); g.arc(px, py, 1.6, 0, 7); g.fill(); }
			g.globalAlpha = 1;
		});
		g.globalCompositeOperation = "source-over";
		g.font = "700 12px " + css("--mono");
		g.textAlign = "center";
		g.textBaseline = "middle";
		clusters.forEach((k, i) => {
			const pulse = (t * 0.0006 + i * 0.13) % 1;
			g.globalAlpha = 1 - pulse;
			g.strokeStyle = k.c;
			g.lineWidth = 1.5;
			g.beginPath(); g.arc(k.cx, k.cy, 13 + pulse * 16, 0, 7); g.stroke();
			g.globalAlpha = 1;
			g.fillStyle = "rgba(12,13,18,0.92)";
			g.lineWidth = 2;
			g.beginPath(); g.arc(k.cx, k.cy, 13, 0, 7); g.fill(); g.stroke();
			g.fillStyle = k.c;
			g.fillText(String(i + 1), k.cx, k.cy + 0.5);
		});
		g.textAlign = "start";
	}
	function nearest(e) {
		const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
		let best = null, bd = 64;
		for (const p of mapPts) { const d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p; } }
		return best;
	}
	cv.addEventListener("pointermove", (e) => {
		const p = nearest(e);
		if (!p) { cv.removeAttribute("data-tip"); cv.style.cursor = "default"; return; }
		const x = p.it, t = x.th && themesByKey.get(x.th);
		cv.style.cursor = t ? "pointer" : "default";
		cv.setAttribute("data-tip", `<b>${esc(CAT[x.cat])}</b> · ${esc(x.co || x.sp)} · ${fmtDate(x.d)}<br>“${esc(x.q.length > 170 ? x.q.slice(0, 168) + "…" : x.q)}”${t ? `<br><span style="opacity:.7">Theme: ${esc(t.name)}</span>` : ""}`);
	});
	cv.addEventListener("click", (e) => {
		const p = nearest(e);
		if (p && p.it.th) { drawerAud = "all"; openTheme(p.it.th); }
	});
	new ResizeObserver(() => renderMap(filtered())).observe(mapEl);
	$("#mapmode").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		const target = document.querySelector(`#f-kind button[data-v="${b.dataset.v}"]`);
		if (target) target.click();
	});
	$("#maplist").addEventListener("click", (e) => {
		const b = e.target.closest(".ml-row");
		if (b) { drawerAud = "all"; openTheme(b.dataset.key); }
	});

	function renderHeadlines(items) {
		const rows = themeStats(items);
		const col = (title, sub, kinds, color) => {
			const top = rows.filter((r) => kinds.includes(r.t.kind)).slice(0, 3);
			return `<div class="card hl"><div class="hl-t" style="--c:${color}">${title}</div><div class="sub">${sub}</div>${
				top.length
					? top.map((r, i) => {
							const q = bestQuote(r.items);
							return `<button class="hl-row" data-key="${esc(r.t.key)}"><span class="hl-n">${i + 1}</span><span class="hl-name">${esc(r.t.name)}</span><span class="hl-c" title="calls">${r.calls.size}</span>${q ? `<span class="hl-quote">${esc(q.q)}<small>— ${esc(q.co || q.sp)}</small></span>` : ""}</button>`;
						}).join("")
					: `<div class="empty">Nothing here for these filters.</div>`
			}</div>`;
		};
		$("#headlines").innerHTML =
			col("Fix first", "Problems & blockers · number = calls", ["problem", "adoption_blocker"], "var(--problem)") +
			col("Keep doing", "Strengths · number = calls", ["strength"], "var(--strength)") +
			col("Most asked for", "Requests · number = calls", ["request"], "var(--request)");
	}

	const AUD_COLOR = { founders: "var(--a1)", buyers: "var(--a2)", candidates: "var(--a3)", team: "var(--a4)", other: "var(--a5)" };
	const AUD_ORDER = ["founders", "buyers", "candidates", "team", "other"];

	function audMix(items, withLegend) {
		const n = new Map();
		for (const x of items) n.set(x.aud, (n.get(x.aud) ?? 0) + 1);
		const parts = AUD_ORDER.filter((k) => n.get(k));
		const bar = `<div class="mix" role="img" aria-label="${parts.map((k) => `${AUD[k]} ${n.get(k)}`).join(", ")}">${parts
			.map((k) => `<span style="flex:${n.get(k)};background:${AUD_COLOR[k]}" data-tip="${esc(AUD[k])}: <b>${n.get(k)}</b>"></span>`)
			.join("")}</div>`;
		return withLegend ? bar + `<div class="mixleg">${parts.map((k) => `<span><i style="background:${AUD_COLOR[k]}"></i>${esc(AUD[k])} ${n.get(k)}</span>`).join("")}</div>` : bar;
	}

	function monthBars(months, color, w, h) {
		const vals = D.months.map((m) => months.get(m) ?? 0);
		const max = Math.max(1, ...vals);
		const step = w / vals.length, bw = Math.max(3, step * 0.62);
		return `<svg width="100%" viewBox="0 0 ${w} ${h + 14}" preserveAspectRatio="none" aria-hidden="true">${vals
			.map((v, i) => {
				const bh = v ? Math.max(3, ((h - 2) * v) / max) : 0;
				const x = i * step + (step - bw) / 2;
				return `<g data-tip="${monthLabel(D.months[i])}: <b>${v}</b>"><rect x="${i * step}" y="0" width="${step}" height="${h + 14}" fill="transparent"></rect>${
					bh ? `<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" rx="2" fill="${color}"></rect>` : `<rect x="${x}" y="${h - 1}" width="${bw}" height="1" fill="var(--grid)"></rect>`
				}<text x="${x + bw / 2}" y="${h + 12}" text-anchor="middle" font-size="9" fill="var(--muted)">${monthLabel(D.months[i]).slice(0, 1)}</text></g>`;
			})
			.join("")}</svg>`;
	}

	const MON = (m) => monthLabel(m);
	let gid = 0;
	function areaChart(months, color, w, h) {
		const vals = D.months.map((m) => months.get(m) ?? 0);
		const max = Math.max(1, ...vals);
		const padT = 16, padB = 18, iw = w, ih = h - padT - padB;
		const step = iw / Math.max(1, vals.length - 1);
		const pts = vals.map((v, i) => [i * step, padT + ih - (ih * v) / max]);
		// smooth path (Catmull-Rom → Bézier)
		let d = `M${pts[0][0]},${pts[0][1]}`;
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
			const clamp = (yv) => Math.max(padT, Math.min(padT + ih, yv));
			const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
			const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
			d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
		}
		const id = `g${gid++}`;
		const peak = vals.indexOf(max);
		const [px, py] = pts[peak];
		const hits = vals
			.map((v, i) => `<rect x="${(i - 0.5) * step}" y="0" width="${step}" height="${h}" fill="transparent" data-tip="${MON(D.months[i])}: <b>${v}</b> quotes"></rect>`)
			.join("");
		return `<div class="area"><svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
			<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.38"></stop><stop offset="100%" stop-color="${color}" stop-opacity="0"></stop></linearGradient></defs>
			<line x1="0" x2="${w}" y1="${padT + ih}" y2="${padT + ih}" stroke="var(--grid)"></line>
			<path d="${d} L${w},${padT + ih} L0,${padT + ih} Z" fill="url(#${id})"></path>
			<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
			<circle cx="${px}" cy="${py}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"></circle>
			<text class="pk" x="${Math.min(w - 20, Math.max(20, px))}" y="${py - 8}" text-anchor="middle" fill="${color}">${max} in ${MON(D.months[peak])}</text>
			<text class="ax" x="0" y="${h - 2}">${MON(D.months[0])}</text>
			<text class="ax" x="${w}" y="${h - 2}" text-anchor="end">${MON(D.months[D.months.length - 1])}</text>${hits}</svg></div>`;
	}

	function audPct(items) {
		const n = new Map();
		for (const x of items) n.set(x.aud, (n.get(x.aud) ?? 0) + 1);
		const tot = items.length || 1;
		return `<div class="mixpct">${AUD_ORDER.filter((k) => n.get(k))
			.sort((a, b) => n.get(b) - n.get(a))
			.slice(0, 2)
			.map((k) => `<span><i style="background:${AUD_COLOR[k]}"></i>${esc(AUD[k])}<b>${Math.round((100 * n.get(k)) / tot)}%</b></span>`)
			.join("")}</div>`;
	}

	function renderBoard(items) {
		const rows = themeStats(items).filter((r) => r.t.kind !== "context" || state.kind === "context");
		$("#board-sub").textContent = `${rows.length} themes · ranked by how many different calls raised them · click any card for all its data`;
		if (!rows.length) return ($("#board").innerHTML = `<div class="empty">No themes match these filters.</div>`);
		const shown = state.all ? rows : rows.slice(0, 18);
		const more = rows.length > 18 ? `<div style="text-align:center;margin-top:14px"><button class="icon-btn" id="more">${state.all ? "Show top 18" : `Show all ${rows.length} themes`}</button></div>` : "";
		$("#board").innerHTML =
			`<div class="tcards">${shown
				.map((r, i) => {
					const c = KIND[r.t.kind].color, q = bestQuote(r.items);
					const feat = i === 0;
					return `<button class="tcard${feat ? " feat" : ""}" data-key="${esc(r.t.key)}" style="--c:${c}">
					<div class="row1"><div style="min-width:0"><div class="kline"><span class="rank">#${i + 1}</span><span class="kdot" style="background:${c}"></span>${KIND[r.t.kind].label}</div><div class="nm">${esc(r.t.name)}</div></div>
					<div class="big"><b>${r.calls.size}</b><span>calls</span></div></div>
					${areaChart(r.months, c, feat ? 760 : 360, feat ? 96 : 70)}
					<div>${audMix(r.items, false)}<div style="height:7px"></div>${audPct(r.items)}</div>
					${q ? `<div class="qb">“${esc(q.q)}”<div class="qby">${esc(q.co || q.sp)} · ${fmtDate(q.d)}</div></div>` : ""}
					<div class="foot"><span><b>${r.items.length}</b> quotes · <b>${r.cos.size}</b> companies</span><span>last <b>${fmtDate(r.last)}</b></span></div></button>`;
				})
				.join("")}</div>` + more;
	}

	function renderDiverging(items) {
		const by = new Map();
		for (const it of items) {
			let a = by.get(it.area);
			if (!a) by.set(it.area, (a = { neg: 0, pos: 0, req: 0 }));
			if (NEG.has(it.cat)) a.neg++;
			else if (it.cat === "praise") a.pos++;
			else if (it.cat === "feature_request") a.req++;
		}
		const rows = [...by.entries()].filter(([, a]) => a.neg + a.pos > 0).sort((x, y) => y[1].neg - x[1].neg || y[1].pos - x[1].pos);
		const max = Math.max(1, ...rows.map(([, a]) => Math.max(a.neg, a.pos)));
		$("#div").innerHTML = rows.length
			? `<div class="div-head"><span></span><span>◀ problems</span><span>praise ▶</span></div>` +
				rows
					.map(([area, a]) => {
						const lw = (88 * a.neg) / max, rw = (88 * a.pos) / max;
						return `<div class="div-row" data-tip="<b>${esc(AREA[area] ?? area)}</b><br>${a.neg} problems · ${a.pos} praise · ${a.req} requests">
						<div class="lab">${esc(AREA[area] ?? area)}</div>
						<div class="l"><span style="width:${lw}%"></span><em style="right:calc(${lw}% + 6px)">${a.neg || ""}</em></div>
						<div class="r"><span style="width:${rw}%"></span><em style="left:calc(${rw}% + 6px)">${a.pos || ""}</em></div></div>`;
					})
					.join("")
			: `<div class="empty">Nothing to show.</div>`;
	}

	function renderHeat(items) {
		const counts = new Map();
		const areas = new Map();
		for (const it of items) {
			const k = `${it.area}|${it.m}`;
			counts.set(k, (counts.get(k) ?? 0) + 1);
			areas.set(it.area, (areas.get(it.area) ?? 0) + 1);
		}
		const rows = [...areas.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
		const max = Math.max(1, ...counts.values());
		const cols = D.months.length;
		let html = `<div class="heat" style="grid-template-columns: 150px repeat(${cols}, minmax(0,1fr))"><div></div>${D.months.map((m) => `<div class="h">${monthLabel(m)}</div>`).join("")}`;
		for (const a of rows) {
			html += `<div class="rl">${esc(AREA[a] ?? a)}</div>`;
			for (const m of D.months) {
				const v = counts.get(`${a}|${m}`) ?? 0;
				const step = v === 0 ? 0 : Math.min(7, 1 + Math.floor((6 * v) / max));
				const ink = step >= 4 ? "#ffffff" : "var(--ink-2)";
				const darkInk = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
				const color = darkInk ? (step >= 6 ? "#0b0b0b" : "#ffffff") : ink;
				html += `<div class="c" style="background:var(--seq-${step});color:${v ? color : "transparent"}" data-tip="<b>${esc(AREA[a] ?? a)}</b> · ${monthLabel(m)}<br>${v} quotes">${v >= max * 0.5 ? v : ""}</div>`;
			}
		}
		$("#heat").innerHTML = rows.length ? `${html}</div>` : `<div class="empty">Nothing to show.</div>`;
	}

	function renderVoices(items) {
		const pick = items
			.filter((x) => x.side === "external" && x.st >= 2)
			.sort((a, b) => (a.d < b.d ? 1 : -1))
			.slice(0, 6);
		$("#voices").innerHTML = pick.length
			? pick
					.map(
						(x) => `<div class="voice"><div class="tmeta"><span class="cat">${CAT[x.cat]}</span><span class="cat">${esc(AREA[x.area] ?? x.area)}</span></div>
				<q>${esc(x.q)}</q><div class="who">${esc(x.sp)} · ${esc(x.co || "–")} · ${fmtDate(x.d)} · <a href="${D.app_url}/conversations/${x.c}" target="_blank" rel="noopener">call ↗</a></div></div>`,
					)
					.join("")
			: `<div class="empty">No quotes match.</div>`;
	}

	// ---------- drawer ----------
	const drawer = $("#drawer"), scrim = $("#scrim");
	let drawerKey = null, drawerAud = "all";
	function openTheme(key) {
		drawerKey = key;
		const all = filtered().filter((x) => x.th === key);
		const t = themesByKey.get(key);
		if (!t) return;
		const c = KIND[t.kind].color;
		const calls = new Set(all.map((x) => x.c));
		const coN = new Map();
		for (const x of all) if (x.co) coN.set(x.co, (coN.get(x.co) ?? 0) + 1);
		const months = new Map();
		for (const x of all) months.set(x.m, (months.get(x.m) ?? 0) + 1);
		const catN = new Map();
		for (const x of all) catN.set(x.cat, (catN.get(x.cat) ?? 0) + 1);
		const catMax = Math.max(1, ...catN.values());
		const ext = all.filter((x) => x.side === "external").length;
		const dates = all.map((x) => x.d).sort();
		$("#d-head").innerHTML = `${kindChip(t.kind)} <span class="cat">${esc(AREA[t.area] ?? t.area)}</span><h3>${esc(t.name)}</h3>
			<div class="dstats">
				<div class="dstat"><b>${calls.size}</b><span>calls</span></div>
				<div class="dstat"><b>${coN.size}</b><span>companies</span></div>
				<div class="dstat"><b>${all.length}</b><span>quotes</span></div>
				<div class="dstat"><b>${Math.round((100 * ext) / Math.max(1, all.length))}%</b><span>from outside</span></div>
				<div class="dstat"><b style="font-size:15px;line-height:1.6">${fmtDate(dates[0]).replace(/ \d{4}$/, "")} → ${fmtDate(dates[dates.length - 1]).replace(/ \d{4}$/, "")}</b><span>first → last heard</span></div>
			</div>`;
		const quotes = () => {
			const list = all.filter((x) => drawerAud === "all" || x.aud === drawerAud).sort((a, b) => b.st - a.st || (a.d < b.d ? 1 : -1));
			return list
				.map(
					(x) => `<div class="qcard" style="--c:${AUD_COLOR[x.aud]}"><q>${esc(x.q)}</q><div class="s">${esc(x.s)}</div>
				<div class="m"><span><i class="dot" style="background:${AUD_COLOR[x.aud]}"></i>${esc(AUD[x.aud])}</span><span>${esc(x.sp)}</span><span>${esc(x.co || "–")}</span><span>${fmtDate(x.d)}</span><span class="cat">${CAT[x.cat]}</span><span>${"●".repeat(x.st)}${"○".repeat(3 - x.st)}</span><a href="${D.app_url}/conversations/${x.c}" target="_blank" rel="noopener">open call ↗</a></div></div>`,
				)
				.join("");
		};
		const audKeys = AUD_ORDER.filter((k) => all.some((x) => x.aud === k));
		const body = () => `
			<div class="dgrid">
				<div class="dpanel"><h4>When it was said</h4>${areaChart(months, c, 460, 150)}</div>
				<div class="dpanel"><h4>Who says it</h4>${audMix(all, true)}<h4 style="margin-top:14px">What kind</h4>${[...catN]
					.sort((a, b) => b[1] - a[1])
					.map(([k, n]) => `<div class="hbar"><span>${CAT[k]}</span><div class="tr"><span style="width:${(100 * n) / catMax}%;background:${c}"></span></div><span class="n">${n}</span></div>`)
					.join("")}</div>
			</div>
			<div class="dpanel"><h4>Companies (${coN.size})</h4><div class="cos">${[...coN]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.map(([k, n]) => `<span class="co">${esc(k)}<b>${n}</b></span>`)
				.join("")}</div></div>
			<div class="duo" style="margin-top:12px">
				<div class="callout"><div class="t">What's going on</div>${esc(t.insight)}</div>
				<div class="callout"><div class="t">Suggested move</div>${esc(t.recommendation)}</div>
			</div>
			<h4 style="margin:18px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">All ${all.length} quotes</h4>
			<div class="qfilter" id="qf"><button data-v="all" aria-pressed="${drawerAud === "all"}">All</button>${audKeys
				.map((k) => `<button data-v="${k}" aria-pressed="${drawerAud === k}"><i class="dot" style="background:${AUD_COLOR[k]}"></i>${esc(AUD[k])}</button>`)
				.join("")}</div>
			<div class="qcards">${quotes()}</div>`;
		$("#d-body").innerHTML = body();
		$("#d-body").onclick = (e) => {
			const b = e.target.closest("#qf button");
			if (!b) return;
			drawerAud = b.dataset.v;
			$("#d-body").innerHTML = body();
		};
		drawer.classList.add("open");
		scrim.classList.add("open");
		drawer.setAttribute("aria-hidden", "false");
		$("#d-close").focus();
	}
	function closeDrawer() {
		drawer.classList.remove("open");
		scrim.classList.remove("open");
		drawer.setAttribute("aria-hidden", "true");
	}
	$("#board").addEventListener("click", (e) => {
		if (e.target.closest("#more")) {
			state.all = !state.all;
			return render();
		}
		const card = e.target.closest(".tcard");
		if (card) {
			drawerAud = "all";
			openTheme(card.dataset.key);
		}
	});
	$("#board").addEventListener("keydown", (e) => {
		const tr = e.target.closest("tr.row");
		if (tr && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			openTheme(tr.dataset.key);
		}
	});
	$("#headlines").addEventListener("click", (e) => {
		const b = e.target.closest(".hl-row");
		if (b) openTheme(b.dataset.key);
	});
	$("#tree").addEventListener("click", (e) => {
		const t = e.target.closest(".bub");
		if (t) { drawerAud = "all"; openTheme(t.dataset.key); }
	});
	// Redraw the treemap whenever its box changes size (window resize, zoom, late layout).
	let resizeT, lastW = 0;
	new ResizeObserver(() => {
		const w = $("#tree").clientWidth;
		if (w === lastW) return;
		lastW = w;
		clearTimeout(resizeT);
		resizeT = setTimeout(() => renderTree(filtered()), 60);
	}).observe($("#tree"));
	scrim.addEventListener("click", closeDrawer);
	$("#d-close").addEventListener("click", closeDrawer);
	document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

	function render() {
		const items = filtered();
		renderKpis(items);
		renderMap(items);
		renderHeadlines(items);
		renderTree(items);
		renderPulse(items);
		renderBoard(items);
		renderDiverging(items);
		renderHeat(items);
		renderVoices(items);
	}
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
	new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
	render();

	// Count-up for the hero numbers (skipped when the viewer prefers reduced motion).
	if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
		for (const el of document.querySelectorAll("[data-count]")) {
			const end = Number(el.dataset.count), t0 = performance.now(), dur = 1100;
			const tick = (t) => {
				const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
				el.textContent = Math.round(end * e).toLocaleString();
				if (p < 1) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		}
	}
})();
