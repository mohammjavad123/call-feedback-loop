// SELECT-only access to the production database of the source app.
//
// Four locks, all must hold for a query to run:
//   1. If profile.dbRef is set, the URL must contain it (no accidental staging/local mix-ups).
//   2. The SQL text must be ONE statement starting with SELECT or WITH, and must not
//      contain any data-changing keyword.
//   3. Every query runs inside its own `BEGIN READ ONLY … ROLLBACK`, so Postgres
//      itself refuses any write, and nothing is ever committed.
//   4. On connect we prove lock 3 works: a no-op UPDATE must be refused.
//
// ⚠️ Never use a SESSION-level read-only setting (SET SESSION CHARACTERISTICS …):
// through the Supavisor pooler it sticks to the pooled server connection and the
// app then fails every write with 25006 "read-only transaction". Read-only is
// enforced per TRANSACTION only, which ends with the ROLLBACK and never leaks.
import pg from "pg";
import { PROFILE } from "./config.ts";

const PROD_REF = PROFILE.dbRef;
const WRITE_WORDS = /\b(insert|update|delete|merge|upsert|truncate|drop|alter|create|grant|revoke|comment|vacuum|analyze|copy|call|do|lock|set|reset|refresh|cluster|reindex|security|listen|notify)\b/i;

export type Row = Record<string, unknown>;

export function assertSelectOnly(sql: string): void {
	const body = sql.trim().replace(/;\s*$/, "");
	if (!/^(select|with)\b/i.test(body)) throw new Error("db: only SELECT / WITH statements are allowed");
	if (body.includes(";")) throw new Error("db: one statement per query");
	// Strip string literals before scanning for write keywords (e.g. ILIKE '%update%').
	const code = body.replace(/'(?:[^']|'')*'/g, "''");
	const hit = code.match(WRITE_WORDS);
	if (hit) throw new Error(`db: keyword "${hit[0]}" is not allowed in a read-only query`);
}

export class ReadOnlyDb {
	private constructor(private readonly client: pg.Client) {}

	static async connect(): Promise<ReadOnlyDb> {
		const url = process.env.PROD_DIRECT_URL ?? "";
		if (!url) throw new Error("db: PROD_DIRECT_URL is not set");
		if (PROD_REF && !url.includes(PROD_REF)) throw new Error("db: PROD_DIRECT_URL is not the expected project (profile.dbRef) — refusing");
		const client = new pg.Client({ connectionString: url.replace(/[?&]pgbouncer=true/, ""), ssl: { rejectUnauthorized: false } });
		await client.connect();
		// Lock 4: prove Postgres refuses a write inside our transaction shape.
		await client.query("BEGIN READ ONLY");
		try {
			await client.query("UPDATE ventures SET name = name WHERE false");
			throw new Error("db: write was NOT refused — refusing to continue");
		} catch (e) {
			if (!String((e as Error).message).includes("read-only")) throw e;
		} finally {
			await client.query("ROLLBACK");
		}
		console.log("db: SELECT-only guard active (per-transaction READ ONLY, write probe refused)");
		return new ReadOnlyDb(client);
	}

	async select<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		assertSelectOnly(sql);
		await this.client.query("BEGIN READ ONLY");
		try {
			const res = await this.client.query(sql, params);
			return res.rows as T[];
		} finally {
			await this.client.query("ROLLBACK");
		}
	}

	async close(): Promise<void> {
		await this.client.end();
	}
}
