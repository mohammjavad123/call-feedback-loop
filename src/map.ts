// Stage 7 — the embedding map: every countable quote placed in 2-D by meaning
// (UMAP over the same embeddings the themes were clustered on, cosine distance, fixed seed).
import { UMAP } from "umap-js";
import { path, writeJson } from "./config.ts";
import { countableItems } from "./items.ts";
import { embedAll, topicText } from "./themes.ts";

const items = countableItems();
const names = [...new Set(items.map((x) => x.speaker))];
const vecs = await embedAll(items.map((x) => topicText(x.summary, names)));
let s = 42;
const random = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const cosine = (a: number[], b: number[]) => {
	let d = 0;
	for (let i = 0; i < a.length; i++) d += a[i] * b[i];
	return 1 - d; // vectors are unit length
};
const umap = new UMAP({ nComponents: 2, nNeighbors: 15, minDist: 0.08, distanceFn: cosine, random });
const xy = umap.fit(vecs.map((v) => Array.from(v)));
writeJson(path("map.json"), Object.fromEntries(items.map((x, i) => [x.id, [Math.round(xy[i][0] * 1000) / 1000, Math.round(xy[i][1] * 1000) / 1000]])));
console.log(`map: ${items.length} quotes placed in 2-D (UMAP, cosine, seed 42)`);
