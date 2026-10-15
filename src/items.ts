// The ONE definition of "a countable quote": found in its transcript, and not from a
// second copy of a meeting (see dedupe.ts). Themes, dashboard and the accuracy check all use it.
import type { Item } from "./extract.ts";
import { path, readJson } from "./config.ts";

export function countableItems(): Item[] {
	const dup = readJson<Record<string, unknown>>(path("duplicates.json"), {});
	return readJson<Item[]>(path("items.json"), [])
		.filter((x) => x.verified && !(x.call_id in dup))
		.map((x) => ((x.side as string) === "external" ? x : { ...x, side: "team" as const }));
}
