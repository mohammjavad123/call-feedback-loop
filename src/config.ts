// Shared settings for every stage.
// - Secrets (DB URL, API keys) come from environment files that are never committed:
//   this repo's .env, plus an optional ENV_FILE (e.g. your app's .env.local) for anything not set.
// - Everything about YOUR organisation and product lives in profile.json (gitignored);
//   profile.example.json is the committed template.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = process.env.DATA_DIR ?? join(ROOT, "data");
export const DIST = process.env.DIST_DIR ?? join(ROOT, "dist");

const LOCAL_ENV = join(ROOT, ".env");
if (existsSync(LOCAL_ENV)) Object.assign(process.env, parseEnv(readFileSync(LOCAL_ENV, "utf8")));
const ENV_FILE = process.env.ENV_FILE;
if (ENV_FILE && existsSync(ENV_FILE)) for (const [k, v] of Object.entries(parseEnv(readFileSync(ENV_FILE, "utf8")))) process.env[k] ??= v;

export type Profile = {
	/** Your organisation, as the LLM should understand it. */
	org: string;
	orgDescription: string;
	/** The product people give feedback about, plus the words people use for it in calls. */
	product: string;
	productAliases: string[];
	productDescription: string;
	/** What kinds of calls the organisation records (helps the screen stage). */
	callTypes: string;
	/** First names / surnames of your own team, removed before clustering and used to tell "team" from "external". */
	teamNames: string[];
	teamEmailDomain: string;
	/** Which venture (tenant) to read, the app URL for "open call" links, and the expected DB project ref (safety lock). */
	ventureId: string;
	appUrl: string;
	dbRef: string;
	/** Dashboard wording. */
	brand: string;
	dashboardTitle: string;
};

const profileFile = process.env.PROFILE_FILE ?? (existsSync(join(ROOT, "profile.json")) ? join(ROOT, "profile.json") : join(ROOT, "profile.example.json"));
export const PROFILE: Profile = JSON.parse(readFileSync(profileFile, "utf8"));

export const VENTURE_ID = PROFILE.ventureId;
/** Team = anyone with this email domain. Everyone else is external. */
export const TEAM_EMAIL_DOMAIN = PROFILE.teamEmailDomain;
export const APP_URL = PROFILE.appUrl;

export function path(...p: string[]): string {
	const f = join(DATA, ...p);
	mkdirSync(dirname(f), { recursive: true });
	return f;
}

export function readJson<T>(file: string, fallback: T): T {
	return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

export function writeJson(file: string, value: unknown): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(value, null, 1));
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(n, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		}),
	);
	return out;
}
