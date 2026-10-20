# Job Hunter v0.1 Implementation Plan (Design-Aligned)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user web app that onboards a candidate, ingests remote Ukrainian frontend jobs from DOU.ua, scores them against a manual profile, and presents a ranked, filterable job list with save/applied/hidden actions.

**Architecture:** Monolith. Hono API on Cloudflare Workers using the Neon HTTP driver; Next.js 16 App Router frontend with CSS Modules and design tokens. Discovery is a DOU RSS adapter behind a `JobSourceAdapter` port. Normalization, HTML-to-text, title/salary parsing, fingerprinting, exclusions, level detection, and scoring are pure functions tested without network or database. The Stitch design is the visual source of truth.

**Tech Stack:** TypeScript 7, Hono 4, Cloudflare Workers (wrangler), Drizzle ORM `1.0.0-rc.4` (`neon-http`, `pg-core`), ArkType 2, Neon PostgreSQL, `fast-xml-parser` for RSS, Next.js 16 / React 19, Vitest.

**Specs:**
- `docs/superpowers/specs/2026-10-08-job-hunter-architecture-design.md`
- `docs/superpowers/specs/2026-10-20-job-hunter-design-refinement.md` (v1.4) — UI scope, scoring weights, and data-model decisions. This plan follows it where the two differ.

**This plan supersedes:** `docs/superpowers/plans/2026-10-08-job-hunter-v0.1.md`.

**Design review:** Stitch project `9010653019088857937`, six screens. The plan deliberately keeps v0.1 lean: manual profile, DOU only, no AI. Design elements that imply missing behaviour are disabled or relabelled, never faked.

## Global Constraints

Copied from both specs. Every task includes this section implicitly.

- **The project must run entirely on free tiers at $0/month.** No task may require, document, or assume a paid plan.
- Workers Free allows **10ms CPU per invocation**. Keep per-request work bounded. `runMatching` accepts `limit` (default 50). Do not score the whole catalog in one request.
- Neon Free caps storage at **1 GB per project**. `source_job.raw` is the growth driver. Never add unbounded storage.
- No microservices, event bus, CQRS, or enterprise patterns.
- Single-user MVP. Every table carries `tenantId`, written as a constant, never enforced.
- **No AI provider call, no queue, no cron, no notifications, no PDF/DOCX parsing, no résumé tailoring, no cover-letter generation in v0.1.** Do not add an AI SDK, a queue binding, or a retry/dead-letter mechanism.
- **The installed `neon-http` driver does not support `db.transaction()`.** It throws `No transactions support in neon-http driver`. Use `db.batch([...])` where atomicity is required, or idempotent writes with unique constraints.
- Drizzle is pinned at `1.0.0-rc.4`. Verify its API against the installed package, not online 0.x docs.
- ArkType is the only runtime validator. Do not add zod, valibot, or typebox.
- `dotenv` is inert on Workers. Local secrets live in `apps/api/.dev.vars`; deployed secrets use `wrangler secret put`.
- Source-specific payloads never touch canonical `Job` columns. Raw payloads go only to `source_job.raw`.
- Provider adapters validate with ArkType at the port boundary before anything reaches a pure function.
- DOU.ua is the only v0.1 source. Remotive is out.
- The frontend is light-mode only. Use CSS Modules plus the tokens in Task 11. No Tailwind, no component library, no icon package.
- Every page that needs a profile redirects to `/onboarding` when none exists.

## Review Focus

Five input classes the design and DOU feed imply, each with its test assigned to the owning task.

1. **DOU title has no `в Company` segment, or has an unusual salary format** (`apps/api/src/features/discovery/adapters/dou.ts` — Task 4). A single malformed title must not drop the feed or throw. Fall back to the raw title, company `DOU`, and null salary.
2. **DOU description contains HTML, `<script>`, entities, or `<li>` bullets** (`apps/api/src/features/discovery/text.ts` — Task 4). The drawer renders text, never raw HTML. Script content must be removed before tags are stripped, and entities must decode.
3. **Salary is undisclosed, in EUR, or below the floor** (`apps/api/src/features/jobs/jobs.repo.ts` — Task 8). Undisclosed is hidden only when the toggle is on. A currency mismatch is treated as unknown, not compared numerically.
4. **Profile has no technologies, or onboarding saved a partial profile** (`apps/api/src/features/matching/score.ts` — Task 9). Empty tech contributes 0, never `NaN`. `/jobs` redirects to onboarding when the profile is absent.
5. **Two concurrent action requests for the same job** (`apps/api/src/features/jobs/jobs.repo.ts` — Task 8). The unique `(userId, jobId)` index plus upsert must make the last write win without a 500.

---

## File Structure

```
apps/api/src/
  db/
    schema.ts                 # tables, constants, derived arktype validators
    client.ts                 # drizzle(neon-http) factory
    index.ts                  # re-exports
  features/
    profiles/
      profiles.types.ts       # arktype payloads + defaults
      profiles.repo.ts
      profiles.service.ts
      profiles.routes.ts
      index.ts
    discovery/
      source.ts               # JobSourceAdapter port + RawJob validator
      text.ts                 # PURE: DOU HTML -> text, entity decode
      adapters/
        dou.ts                # RSS fetch + title/salary parsing
      normalize.ts            # PURE: RawJob -> NormalizedJob
      fingerprint.ts          # PURE: sha256 identity
      discovery.repo.ts
      ingest.ts
      discovery.routes.ts
      index.ts
    matching/
      exclusions.ts           # PURE
      levels.ts               # PURE
      score.ts                # PURE, weights from spec
      matching.repo.ts
      matching.routes.ts
      index.ts
    jobs/
      jobs.repo.ts            # ranked query + actions
      jobs.routes.ts
      index.ts
  index.ts                    # Hono app, CORS, /health, mounts
apps/api/tests/               # mirrors src paths
apps/web/
  app/
    layout.tsx
    globals.css
    page.tsx                  # redirect
    onboarding/page.tsx + onboarding.module.css
    jobs/page.tsx + jobs-client.tsx + jobs.module.css
    resume/page.tsx + resume-client.tsx + resume.module.css
    settings/page.tsx + settings-client.tsx + settings.module.css
  components/
    app-shell.tsx
    job-card.tsx
    job-drawer.tsx
    ui/
      button.tsx
      field.tsx
      icons.tsx
      match-badge.tsx
      tag-input.tsx
      toast.tsx
      toggle.tsx
  lib/
    api.ts
    format.ts
    format.test.ts
    profile-defaults.ts
```

Tests for API live in `apps/api/tests/`, not beside sources. UI logic that is worth testing is pure and lives in `apps/web/lib/`.

---

## Task 1: API harness, CORS, and health

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/vitest.config.ts` (keep existing)
- Modify: `turbo.json`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/tests/api.test.ts`
- Create: `apps/api/.dev.vars.example`
- Modify: `apps/api/.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `app.request()` works in tests; `GET /health` returns `{ ok: true }`; browser calls from `http://localhost:3000` receive CORS headers; `env.DATABASE_URL` and `env.ALLOWED_ORIGIN` are typed.

- [ ] **Step 1: Write the failing API test**

Create `apps/api/tests/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("api shell", () => {
  it("returns health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("allows the local web origin", async () => {
    const res = await app.request("/health", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test api`
Expected: FAIL — `/health` returns 404 and no CORS header.

- [ ] **Step 3: Add CORS, `/health`, and typed bindings**

In `apps/api/src/index.ts`, define `type Bindings = { DATABASE_URL: string; ALLOWED_ORIGIN?: string }`, instantiate `new Hono<{ Bindings: Bindings }>()`, mount `cors` from `hono/cors` for `*` with `origin: (origin, c) => origin === (c.env.ALLOWED_ORIGIN ?? "http://localhost:3000") ? origin : ""`, add `GET /health` returning `c.json({ ok: true })`, and keep a root text route.

- [ ] **Step 4: Add the example secret file**

Create `apps/api/.dev.vars.example`:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
ALLOWED_ORIGIN=http://localhost:3000
```

Append `.dev.vars` to `apps/api/.gitignore` if missing.

- [ ] **Step 5: Run the API tests**

Run: `pnpm --filter api test api`
Expected: PASS, 2 tests.

- [ ] **Step 6: Confirm the root test task reaches the API**

Run: `pnpm turbo run test`
Expected: PASS; `api` task reported.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/tests/api.test.ts apps/api/src/index.ts apps/api/.dev.vars.example apps/api/.gitignore turbo.json
git commit -m "test(api): add health, cors, and api harness"
```

---

## Task 2: Canonical schema and validators

**Files:**
- Replace: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/index.ts`
- Test: `apps/api/tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - Constants: `DEFAULT_TENANT_ID = "default"`, `SINGLE_USER_ID = "single-user"`, `SINGLE_CANDIDATE_ID = "00000000-0000-0000-0000-000000000001"`, `SINGLE_JOB_PROFILE_ID = "00000000-0000-0000-0000-000000000002"`
  - Tables: `jobSource`, `sourceJob`, `job`, `candidate`, `jobProfile`, `match`, `jobAction`
  - Validators: `JobInsert`, `JobSelect`, `CandidateInsert`, `CandidateSelect`, `JobProfileInsert`, `JobProfileSelect`, `MatchInsert`, `MatchSelect`, `SourceJobInsert`, `JobActionInsert`
  - Type `Db` is exported from `db/client.ts`, not from `schema.ts`.

**Schema decisions fixed by this plan** (do not re-invent):

- Every table has `tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID)`.
- `job`: `id` uuid PK default random, `tenantId`, `userId` text notNull default `SINGLE_USER_ID`, `title` text notNull, `company` text notNull, `location` text notNull default `""`, `isRemote` boolean notNull default false, `description` text notNull default `""`, `postedAt` timestamp, `salaryMin` integer, `salaryMax` integer, `salaryCurrency` text, `postingUrl` text, `fingerprint` text notNull unique, `sourceJobCount` integer notNull default 1, `createdAt`/`updatedAt` timestamps notNull default now.
- `job` indexes: unique on `fingerprint`, plain on `postedAt`.
- `jobSource`: `id` uuid PK default random, `tenantId`, `key` text notNull unique, `name` text notNull, `integrationType` text notNull check in `('api','scraper','upload')`, `lastSyncedAt` timestamp.
- `sourceJob`: `id` uuid PK default random, `tenantId`, `jobId` uuid notNull FK→`job.id` cascade, `sourceId` uuid notNull FK→`job_source.id` cascade, `externalId` text notNull, `raw` jsonb notNull, `fetchedAt` timestamp notNull default now. Unique index on `(sourceId, externalId)`.
- `candidate`: `id` uuid PK, `tenantId`, `name` text notNull, `email` text notNull, `headline` text, `summary` text notNull default `""`, `location` text notNull default `""`, `timezone` text notNull default `""`, `experience` jsonb notNull default `[]`, `skills` jsonb notNull default `[]`, `technologies` jsonb notNull default `[]`, `education` jsonb notNull default `[]`, `languages` jsonb notNull default `[]`, `cvUrl` text, timestamps.
- `jobProfile`: `id` uuid PK, `tenantId`, `candidateId` uuid notNull FK→`candidate.id` cascade, `desiredRoles` jsonb notNull default `[]`, `locations` jsonb notNull default `[]`, `workModes` jsonb notNull default `[]`, `salaryMin` integer, `salaryMax` integer, `salaryCurrency` text default `"USD"`, `preferredTechnologies` jsonb notNull default `[]`, `exclusionPatterns` jsonb notNull default `[]`, `positionLevels` jsonb notNull default `[]`, `minMatchScore` integer notNull default 75, `hideUndisclosedSalary` boolean notNull default false, `updatedAt` timestamp notNull default now. Unique index on `candidateId`.
- `match`: `id` uuid PK default random, `tenantId`, `candidateId` uuid notNull FK, `jobId` uuid notNull FK cascade, `score` integer notNull, `matchedSignals` jsonb notNull default `[]`, `missingSignals` jsonb notNull default `[]`, `excluded` boolean notNull default false, `exclusionReasons` jsonb notNull default `[]`, `explanation` text notNull default `""`, `computedAt` timestamp notNull default now. Unique index on `(candidateId, jobId)`.
- `jobAction`: `id` uuid PK default random, `tenantId`, `userId` text notNull, `jobId` uuid notNull FK→`job.id` cascade, `status` text notNull check in `('saved','applied','hidden')`, `createdAt`/`updatedAt` timestamps notNull default now. Unique index on `(userId, jobId)`.
- Do not put `drizzle()` or `createDb` in `schema.ts`. That belongs in `client.ts`.

- [ ] **Step 1: Write the failing schema tests**

Create `apps/api/tests/db/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type } from "arktype";
import { JobActionInsert, JobInsert } from "../../src/db/schema";

describe("derived arktype schemas", () => {
  it("rejects a job insert with no title", () => {
    const result = JobInsert({ company: "Acme", fingerprint: "abc" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a negative salary", () => {
    const result = JobInsert({
      title: "Frontend Engineer",
      company: "Acme",
      fingerprint: "abc",
      salaryMin: -5,
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts a well-formed job insert", () => {
    const result = JobInsert({
      title: "Frontend Engineer",
      company: "Acme",
      fingerprint: "abc",
      isRemote: true,
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects an unknown action status", () => {
    const result = JobActionInsert({
      userId: "single-user",
      jobId: "00000000-0000-0000-0000-000000000010",
      status: "archived",
    });
    expect(result instanceof type.errors).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test schema`
Expected: FAIL — validators not exported.

- [ ] **Step 3: Implement `apps/api/src/db/schema.ts`**

Use `pgTable`, `text`, `boolean`, `integer`, `timestamp`, `uuid`, `jsonb`, `uniqueIndex`, `index`, and `check` from `drizzle-orm/pg-core`, and `sql` from `drizzle-orm`. Implement the tables exactly as specified.

Export the derived validators:

```ts
import { type } from "arktype";

export const JobInsert = createInsertSchema(job, {
  salaryMin: (schema) => schema.and(type("number.integer >= 0")),
  salaryMax: (schema) => schema.and(type("number.integer >= 0")),
});
export const JobSelect = createSelectSchema(job);
export const CandidateInsert = createInsertSchema(candidate);
export const CandidateSelect = createSelectSchema(candidate);
export const JobProfileInsert = createInsertSchema(jobProfile, {
  minMatchScore: (schema) => schema.and(type("number.integer >= 0")).and(type("number.integer <= 100")),
  salaryMin: (schema) => schema.and(type("number.integer >= 0")),
  salaryMax: (schema) => schema.and(type("number.integer >= 0")),
});
export const JobProfileSelect = createSelectSchema(jobProfile);
export const MatchInsert = createInsertSchema(match);
export const MatchSelect = createSelectSchema(match);
export const SourceJobInsert = createInsertSchema(sourceJob);
export const JobActionInsert = createInsertSchema(jobAction);
```

ArkType has no `.min()` method. Use `schema.and(type("number.integer >= 0"))`; the drizzle adapter applies nullable/optional after the refinement. If the installed API differs, use the installed types as the source of truth and keep the negative-salary test passing.

- [ ] **Step 4: Create `apps/api/src/db/index.ts`**

Re-export `./schema` and `./client`. Do not create `client.ts` until Task 3; the re-export can be added then.

- [ ] **Step 5: Run the schema tests**

Run: `pnpm --filter api test schema`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify types**

Run: `pnpm --filter api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/index.ts apps/api/tests/db/schema.test.ts
git commit -m "feat(db): design-aligned schema and validators"
```

---

## Task 3: Migrations and Neon client

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/client.ts`
- Modify: `apps/api/src/db/index.ts`
- Create: `apps/api/tests/db/client.test.ts`
- Create: `apps/api/drizzle/` (generated)

**Interfaces:**
- Consumes: tables from Task 2
- Produces: `createDb(connectionString: string): NeonHttpDatabase`; `type Db = ReturnType<typeof createDb>`

- [ ] **Step 1: Write the failing client test**

Create `apps/api/tests/db/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client";
import { job } from "../../src/db/schema";

describe("createDb", () => {
  it("builds a query without connecting", () => {
    const db = createDb("postgresql://user:pass@host/db");
    expect(db.select().from(job)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test client`
Expected: FAIL — cannot resolve `../../src/db/client`.

- [ ] **Step 3: Implement `apps/api/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  return drizzle(connectionString, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 4: Run the client test**

Run: `pnpm --filter api test client`
Expected: PASS.

- [ ] **Step 5: Add the drizzle-kit config**

Create `apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
```

- [ ] **Step 6: Generate the migration**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api exec drizzle-kit generate`
Expected: `apps/api/drizzle/0000_*.sql` containing all seven tables. If the pinned RC rejects the config shape, read the installed `drizzle-kit` types and adjust only `drizzle.config.ts`.

- [ ] **Step 7: Apply the migration to the dev database**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api exec drizzle-kit migrate`
Expected: migration applied. Do not add a paid Neon tier.

- [ ] **Step 8: Commit**

```bash
git add apps/api/drizzle.config.ts apps/api/src/db/client.ts apps/api/src/db/index.ts apps/api/tests/db/client.test.ts apps/api/drizzle
git commit -m "feat(db): neon client and initial migration"
```

---

## Task 4: DOU RSS adapter and text parsing

**Files:**
- Modify: `apps/api/package.json` — add `fast-xml-parser`
- Create: `apps/api/src/features/discovery/source.ts`
- Create: `apps/api/src/features/discovery/text.ts`
- Create: `apps/api/src/features/discovery/adapters/dou.ts`
- Test: `apps/api/tests/features/discovery/dou.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RawJob` validator: `{ externalId, title, company, location, isRemote, description, postingUrl, postedAt?, salaryMin?, salaryMax?, salaryCurrency?, raw }`
  - `JobSourceAdapter`: `{ key: string; name: string; fetchJobs(): Promise<RawJob[]> }`
  - `DOU_FEED_URL = "https://jobs.dou.ua/vacancies/feeds/?category=Front+End&remote="`
  - `douAdapter: JobSourceAdapter`
  - `parseDouTitle(raw: string): { title: string; company: string; location: string; isRemote: boolean; salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null }`
  - `parseSalary(text: string): { min: number | null; max: number | null; currency: string | null }`
  - `htmlToText(html: string): string`

- [ ] **Step 1: Write the failing parser tests**

Create `apps/api/tests/features/discovery/dou.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type } from "arktype";
import { parseDouTitle, parseSalary } from "../../../src/features/discovery/adapters/dou";
import { htmlToText } from "../../../src/features/discovery/text";
import { RawJobValidator } from "../../../src/features/discovery/source";

describe("parseDouTitle", () => {
  it("splits role, company, remote, and salary", () => {
    const out = parseDouTitle(
      "Middle+ Frontend (Angular) Developer в Rational Soft, $1900–2200, віддалено",
    );
    expect(out.title).toBe("Middle+ Frontend (Angular) Developer");
    expect(out.company).toBe("Rational Soft");
    expect(out.location).toBe("Remote (Ukraine)");
    expect(out.isRemote).toBe(true);
    expect(out.salaryMin).toBe(1900);
    expect(out.salaryMax).toBe(2200);
    expect(out.salaryCurrency).toBe("USD");
  });

  it("keeps company dots and drops city names for remote jobs", () => {
    const out = parseDouTitle(
      "E-commerce Web Developer (WordPress-Shopify) в Deveit sp. z o.o., $2000–2200, віддалено",
    );
    expect(out.company).toBe("Deveit sp. z o.o.");
    expect(out.location).toBe("Remote (Ukraine)");
  });

  it("handles an open-ended salary", () => {
    const out = parseDouTitle(
      "React.js Developer в Interactive Online Technologies, від $5000, віддалено",
    );
    expect(out.salaryMin).toBe(5000);
    expect(out.salaryMax).toBeNull();
  });

  it("falls back safely when the title has no company segment", () => {
    const out = parseDouTitle("Senior Frontend Engineer");
    expect(out.title).toBe("Senior Frontend Engineer");
    expect(out.company).toBe("DOU");
    expect(out.salaryMin).toBeNull();
  });
});

describe("parseSalary", () => {
  it("parses thousands separators and EUR", () => {
    expect(parseSalary("€1,700—€2,000/month")).toEqual({
      min: 1700,
      max: 2000,
      currency: "EUR",
    });
  });

  it("returns nulls when no salary is present", () => {
    expect(parseSalary("Remote (Ukraine)")).toEqual({
      min: null,
      max: null,
      currency: null,
    });
  });
});

describe("htmlToText", () => {
  it("removes scripts, keeps bullets, and decodes entities", () => {
    const out = htmlToText(
      '<script>alert("x")</script><p>Hello&nbsp;<b>React</b></p><ul><li>TypeScript</li><li>Node.js</li></ul>',
    );
    expect(out).toContain("Hello React");
    expect(out).toContain("• TypeScript");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<");
  });
});

describe("RawJobValidator", () => {
  it("rejects a row with no externalId", () => {
    const result = RawJobValidator({ title: "Dev", company: "Acme" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts a minimal row", () => {
    const result = RawJobValidator({
      externalId: "1",
      title: "Dev",
      company: "Acme",
      location: "Remote (Ukraine)",
      isRemote: true,
      description: "TypeScript",
      postingUrl: "https://x",
      raw: {},
    });
    expect(result instanceof type.errors).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test dou`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add `fast-xml-parser` and implement `source.ts`**

Add `"fast-xml-parser": "^5.3.2"` to `apps/api/package.json` dependencies and run `pnpm install`.

In `source.ts`, define the ArkType `RawJob` object and export `RawJobValidator = RawJob`. Required: `externalId`, `title`, `company`, non-empty strings; `location` string; `isRemote` boolean; `description` string; `postingUrl` string; `raw` unknown. Optional: `postedAt`, `salaryMin`, `salaryMax`, `salaryCurrency`.

- [ ] **Step 4: Implement `text.ts`**

`htmlToText` must:
1. Remove `<script>…</script>` and `<style>…</style>` blocks case-insensitively.
2. Replace `<br>`, `</p>`, `</div>`, `</li>` with `\n`; replace `<li>` with `• `.
3. Strip remaining tags.
4. Decode `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, and numeric entities.
5. Collapse three or more newlines to two and trim.

- [ ] **Step 5: Implement `adapters/dou.ts`**

Use `XMLParser` from `fast-xml-parser` with `{ ignoreAttributes: false, processEntities: true }`.

`parseDouTitle`:
- Split on the **last** `" в "`.
- Role is the left side.
- Company is the right side up to the first comma.
- If there is no `" в "`, use the raw title and company `"DOU"`.
- Remote when the tail contains `"віддалено"`. Location is `"Remote (Ukraine)"` when remote, otherwise the remaining city segments joined with `", "`, or `"Ukraine"`.
- Salary comes from `parseSalary(tail)`.

`parseSalary`:
- Accept `$`, `€`, `USD`, `EUR`, `грн`.
- Accept `$1900–2200`, `$1,900—$2,200`, `від $5000`, `€1,700—€2,000/month`.
- Strip commas and whitespace from numbers.
- Return `{ min, max, currency }`; `max` is `null` for `від`.

`douAdapter.fetchJobs`:
- Fetch `DOU_FEED_URL` with `User-Agent: job-hunter/0.1`.
- Throw a clear error when the response is not ok.
- Normalize `rss.channel.item` to an array (single item is an object).
- Map each item: `externalId` = `new URL(link).pathname`, `postingUrl` = link, `postedAt` = pubDate, `description` = `htmlToText(description)`, plus parsed title fields and `raw` = item. Convert `null` salary values to `undefined` so they satisfy the optional `RawJob` fields.
- Run each row through `RawJobValidator`; drop invalid rows rather than throwing.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter api test dou`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/features/discovery/source.ts apps/api/src/features/discovery/text.ts apps/api/src/features/discovery/adapters/dou.ts apps/api/tests/features/discovery/dou.test.ts
git commit -m "feat(discovery): dou rss adapter and text parsing"
```

---

## Task 5: Normalization and fingerprinting

**Files:**
- Create: `apps/api/src/features/discovery/normalize.ts`
- Create: `apps/api/src/features/discovery/fingerprint.ts`
- Test: `apps/api/tests/features/discovery/normalize.test.ts`

**Interfaces:**
- Consumes: `RawJob` from Task 4
- Produces:
  - `NormalizedJob = { title, company, location, isRemote, description, postedAt: Date | null, salaryMin: number | null, salaryMax: number | null, salaryCurrency: string | null, postingUrl }`
  - `normalize(raw: RawJob): NormalizedJob`
  - `fingerprint(job: NormalizedJob): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/features/discovery/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize } from "../../../src/features/discovery/normalize";
import { fingerprint } from "../../../src/features/discovery/fingerprint";

const base = {
  externalId: "1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote (Ukraine)",
  isRemote: true,
  description: "React and TypeScript",
  postingUrl: "https://x",
  raw: {},
};

describe("normalize", () => {
  it("never throws on missing salary and date", () => {
    const out = normalize(base);
    expect(out.salaryMin).toBeNull();
    expect(out.salaryMax).toBeNull();
    expect(out.postedAt).toBeNull();
  });

  it("trims and collapses whitespace", () => {
    expect(normalize({ ...base, title: "  Frontend   Engineer  " }).title).toBe(
      "Frontend Engineer",
    );
  });

  it("parses ISO dates and rejects garbage", () => {
    expect(normalize({ ...base, postedAt: "2026-01-15T10:00:00Z" }).postedAt).toBeInstanceOf(Date);
    expect(normalize({ ...base, postedAt: "not-a-date" }).postedAt).toBeNull();
  });
});

describe("fingerprint", () => {
  it("is case- and whitespace-insensitive", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, title: "  frontend  engineer " }));
    expect(a).toBe(b);
  });

  it("ignores postingUrl", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, postingUrl: "https://y" }));
    expect(a).toBe(b);
  });

  it("distinguishes companies", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, company: "Globex" }));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test normalize`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `normalize.ts`**

Pure, no I/O, no `Date.now()`. Collapse internal whitespace and trim. Missing salaries become `null`. Parse `postedAt` with `new Date` in a try/catch returning `null`. Never throw.

- [ ] **Step 4: Implement `fingerprint.ts`**

Build an identity string from lowercased `title`, `company`, `location`, and the ISO string of `postedAt` (empty when null). Hash with `crypto.subtle.digest("SHA-256", ...)` and return lowercase hex. Async.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter api test normalize`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/discovery/normalize.ts apps/api/src/features/discovery/fingerprint.ts apps/api/tests/features/discovery/normalize.test.ts
git commit -m "feat(discovery): normalization and dedup fingerprint"
```

---

## Task 6: Ingest orchestration and discovery routes

**Files:**
- Create: `apps/api/src/features/discovery/discovery.repo.ts`
- Create: `apps/api/src/features/discovery/ingest.ts`
- Create: `apps/api/src/features/discovery/discovery.routes.ts`
- Create: `apps/api/src/features/discovery/index.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/features/discovery/ingest.test.ts`

**Interfaces:**
- Consumes: `douAdapter`, `normalize`, `fingerprint`, `createDb`, `sourceJob`, `job`, `jobSource`
- Produces:
  - `ingestJobs(db: Db, adapter: JobSourceAdapter): Promise<IngestResult>` where `IngestResult = { fetched, inserted, merged, failed }`
  - `upsertSource(db, key, name, integrationType): Promise<string>`
  - `findJobByFingerprint(db, fp): Promise<{ id: string } | null>`
  - `insertJobAndSource(db, job: NormalizedJob, fp: string, sourceId: string, externalId: string, raw: unknown): Promise<{ id: string; created: boolean; sourceLinked: boolean }>`
  - HTTP `POST /api/discovery/run`, `GET /api/sources`

- [ ] **Step 1: Write the failing ingest test**

Create `apps/api/tests/features/discovery/ingest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDb } from "../../../src/db/client";
import { ingestJobs } from "../../../src/features/discovery/ingest";
import type { JobSourceAdapter } from "../../../src/features/discovery/source";

const baseRaw = {
  externalId: "1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote (Ukraine)",
  isRemote: true,
  description: "React and TypeScript",
  postingUrl: "https://x",
  raw: {},
};

function adapterReturning(rows: unknown[]): JobSourceAdapter {
  return { key: "test", name: "Test", fetchJobs: async () => rows as never };
}

describe.skipIf(!process.env.DATABASE_URL)("ingestJobs", () => {
  it("inserts once and merges the second copy", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    const raw = { ...baseRaw, title: `Frontend Engineer ${crypto.randomUUID()}` };
    const first = await ingestJobs(db, adapterReturning([raw]));
    expect(first.inserted).toBe(1);
    const second = await ingestJobs(db, adapterReturning([raw]));
    expect(second.inserted).toBe(0);
    expect(second.merged).toBe(1);
  });

  it("keeps exactly one canonical job under concurrent ingest", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    const raw = { ...baseRaw, title: `Frontend Engineer ${crypto.randomUUID()}` };
    const [a, b] = await Promise.all([
      ingestJobs(db, adapterReturning([raw])),
      ingestJobs(db, adapterReturning([raw])),
    ]);
    expect(a.inserted + b.inserted).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test ingest`
Expected: FAIL — module not found (or skip without `DATABASE_URL`).

- [ ] **Step 3: Implement `discovery.repo.ts`**

No transactions. The flow is idempotent through unique keys:

1. `upsertSource` uses `onConflictDoUpdate` on `jobSource.key` and returns the id.
2. `insertJobAndSource` inserts `job` with `onConflictDoNothing({ target: job.fingerprint })` and `.returning({ id: job.id })`.
3. If no row was returned, `findJobByFingerprint` supplies the existing id and `created = false`.
4. Insert `sourceJob` with `onConflictDoNothing({ target: [sourceJob.sourceId, sourceJob.externalId] })` and `.returning({ id: sourceJob.id })`.
5. When `sourceLinked` is true and `created` is false, increment `job.sourceJobCount` by 1.
6. Use `crypto.randomUUID()` for `job.id` and `sourceJob.id` so the inserts need no round trip for generated ids.

- [ ] **Step 4: Implement `ingest.ts`**

Upsert the source, fetch, then for each row: `normalize`, `await fingerprint`, `insertJobAndSource`. Wrap each row in its own try/catch so one bad row increments `failed` and the batch continues. Update `jobSource.lastSyncedAt` at the end. Return `{ fetched, inserted, merged, failed }`.

- [ ] **Step 5: Run the test**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api test ingest`
Expected: PASS, 2 tests. Without `DATABASE_URL`, they skip.

- [ ] **Step 6: Implement routes and mount**

`discovery.routes.ts`:
- `POST /run` calls `ingestJobs(db, douAdapter)` and returns the result.
- `GET /sources` returns `[{ key, name, integrationType, lastSyncedAt }]`.

Mount at `/api/discovery` and `/api/sources` in `src/index.ts`. Read `DATABASE_URL` from `c.env`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/discovery apps/api/src/index.ts apps/api/tests/features/discovery/ingest.test.ts
git commit -m "feat(discovery): idempotent dou ingest and routes"
```

---

## Task 7: Profile API

**Files:**
- Create: `apps/api/src/features/profiles/profiles.types.ts`
- Create: `apps/api/src/features/profiles/profiles.repo.ts`
- Create: `apps/api/src/features/profiles/profiles.service.ts`
- Create: `apps/api/src/features/profiles/profiles.routes.ts`
- Create: `apps/api/src/features/profiles/index.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/features/profiles/profiles.test.ts`

**Interfaces:**
- Consumes: `SINGLE_CANDIDATE_ID`, `SINGLE_JOB_PROFILE_ID`, `candidate`, `jobProfile`, `createDb`
- Produces:
  - `ProfilePayload`: `{ candidate?: CandidatePayload; jobProfile: JobProfilePayload }`
  - `DEFAULT_SEARCH_PROFILE`
  - `DEFAULT_CANDIDATE = { name: "You", email: "" }`
  - `getProfile(db): Promise<{ candidate: CandidateSelect; jobProfile: JobProfileSelect } | null>`
  - `upsertProfile(db, payload): Promise<void>`
  - `GET /api/profile` → `200` profile or `404 { error: "profile_not_found" }`
  - `PUT /api/profile` → `204`

- [ ] **Step 1: Write the failing validator tests**

Create `apps/api/tests/features/profiles/profiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type } from "arktype";
import { ProfilePayload } from "../../../src/features/profiles/profiles.types";

describe("ProfilePayload", () => {
  it("rejects a payload with no jobProfile", () => {
    expect(ProfilePayload({}) instanceof type.errors).toBe(true);
  });

  it("rejects an empty desiredRoles array", () => {
    const result = ProfilePayload({
      jobProfile: { desiredRoles: [] },
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts jobProfile-only onboarding payloads", () => {
    const result = ProfilePayload({
      jobProfile: {
        desiredRoles: ["Frontend Engineer"],
        preferredTechnologies: ["React"],
      },
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it("rejects a match cutoff outside 0–100", () => {
    const result = ProfilePayload({
      jobProfile: { desiredRoles: ["Frontend Engineer"], minMatchScore: 150 },
    });
    expect(result instanceof type.errors).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test profiles`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `profiles.types.ts`**

Export ArkType objects for `ExperienceEntry` (`{ title, company, startDate, endDate, summary }` strings), `EducationEntry` (`{ degree, school, years }`), `LanguageEntry` (`{ language, level }`), `LocationPreference` (`{ country, remoteOnly }`), `CandidatePayload`, `JobProfilePayload`, and `ProfilePayload`.

`CandidatePayload` fields: `name`, `email`, `headline`, `summary`, `location`, `timezone`, `experience`, `skills`, `technologies`, `education`, `languages`, `cvUrl`. All optional except `name` and `email`, because onboarding may omit the candidate.

`DEFAULT_CANDIDATE = { name: "You", email: "" }` is the candidate inserted on the first onboarding save. The database requires both fields; onboarding collects neither. The Résumé page replaces them.

`JobProfilePayload`: `desiredRoles: string[] >= 1`, `locations`, `workModes`, `salaryMin: number >= 0 | null`, `salaryMax`, `salaryCurrency`, `preferredTechnologies`, `exclusionPatterns`, `positionLevels`, `minMatchScore: number 0–100`, `hideUndisclosedSalary: boolean`. Apply defaults for any field the onboarding form omits.

Export `DEFAULT_SEARCH_PROFILE` with:
- `desiredRoles: ["Frontend Engineer", "React Developer"]`
- `locations: [{ country: "Ukraine", remoteOnly: true }]`
- `workModes: ["Remote (Ukraine)", "Remote (Global)"]`
- `salaryMin: 500`, `salaryMax: null`, `salaryCurrency: "USD"`
- `preferredTechnologies: ["React", "TypeScript", "Next.js", "Node.js"]`
- `exclusionPatterns: ["gambling", "crypto", "blockchain", "NFT", "dating", "adult", "gaming", "on-call"]`
- `positionLevels: ["Trainee", "Junior", "Middle", "Strong Junior-Middle"]`
- `minMatchScore: 75`, `hideUndisclosedSalary: false`

- [ ] **Step 4: Run the validator tests**

Run: `pnpm --filter api test profiles`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement repo, service, and routes**

`getProfile` selects `candidate` by `SINGLE_CANDIDATE_ID` and `jobProfile` by `SINGLE_JOB_PROFILE_ID`. Return `null` when the candidate or job profile is missing.

`upsertProfile` uses `db.batch([...])` for the candidate and job-profile upserts. Never `db.transaction`. When `payload.candidate` is absent, insert `DEFAULT_CANDIDATE` if missing; do not overwrite an existing candidate. Use `onConflictDoUpdate` with the fixed ids.

Routes:
- `GET /` returns `getProfile(db)` or 404.
- `PUT /` validates with `ProfilePayload`; on `type.errors` return `400 { errors: result.summary }`; otherwise upsert and return 204.

Mount at `/api/profile`.

- [ ] **Step 6: Add route tests gated on `DATABASE_URL`**

In the same test file, add `describe.skipIf(!process.env.DATABASE_URL)` tests:
- `GET /api/profile` returns 404 on a clean database.
- `PUT /api/profile` with a valid payload then `GET` returns the saved roles.
- `PUT` with an empty `desiredRoles` returns 400.

- [ ] **Step 7: Run the suite**

Run: `pnpm --filter api test profiles`
Expected: PASS; route tests skip without `DATABASE_URL`, pass with it.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/features/profiles apps/api/src/index.ts apps/api/tests/features/profiles
git commit -m "feat(profiles): manual candidate and search profile api"
```

---

## Task 8: Ranked jobs API and action upsert

**Files:**
- Create: `apps/api/src/features/jobs/jobs.repo.ts`
- Create: `apps/api/src/features/jobs/jobs.routes.ts`
- Create: `apps/api/src/features/jobs/index.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/features/jobs/jobs.test.ts`

**Interfaces:**
- Consumes: `job`, `match`, `jobAction`, `jobSource`, `jobProfile`, `SINGLE_CANDIDATE_ID`, `SINGLE_USER_ID`
- Produces:
  - `parseJobsQuery(raw: Record<string, string | undefined>): { page: number; pageSize: number; sort: "match" | "newest"; q: string }`
  - `JobActionPayload = { status: "saved" | "applied" | "hidden" | null }`
  - `listRankedJobs(db, params): Promise<{ items: RankedJob[]; total: number; page: number; pageSize: number; lastSyncedAt: string | null }>`
  - `setJobAction(db, jobId, status): Promise<void>`
  - `GET /api/jobs`, `POST /api/jobs/:id/action`

`RankedJob` response shape:

```ts
type RankedJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  description: string;
  postedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postingUrl: string | null;
  score: number;
  matchedSignals: string[];
  missingSignals: string[];
  excluded: boolean;
  exclusionReasons: { pattern: string; field: string; matchedText: string }[];
  explanation: string;
  action: "saved" | "applied" | "hidden" | null;
};
```

- [ ] **Step 1: Write the failing query/validator tests**

Create `apps/api/tests/features/jobs/jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type } from "arktype";
import { JobActionPayload, parseJobsQuery } from "../../../src/features/jobs/jobs.repo";

describe("parseJobsQuery", () => {
  it("clamps page and page size", () => {
    expect(parseJobsQuery({ page: "0", pageSize: "999" })).toEqual({
      page: 1,
      pageSize: 24,
      sort: "match",
      q: "",
    });
  });

  it("trims search and accepts newest sort", () => {
    expect(parseJobsQuery({ q: "  react ", sort: "newest" })).toEqual({
      page: 1,
      pageSize: 6,
      sort: "newest",
      q: "react",
    });
  });
});

describe("JobActionPayload", () => {
  it("accepts saved, applied, hidden, and null", () => {
    for (const status of ["saved", "applied", "hidden", null]) {
      expect(JobActionPayload({ status }) instanceof type.errors).toBe(false);
    }
  });

  it("rejects archived", () => {
    expect(JobActionPayload({ status: "archived" }) instanceof type.errors).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test jobs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseJobsQuery` and `JobActionPayload`**

`parseJobsQuery` defaults: `page=1`, `pageSize=6`, `sort="match"`, `q=""`. Clamp `page` to `>=1`; clamp `pageSize` to `1..24`. Accept only `match` and `newest`; anything else is `match`. Trim `q` and cap it at 100 characters.

`JobActionPayload` is an ArkType object with `status: "'saved' | 'applied' | 'hidden' | null"`.

- [ ] **Step 4: Run the pure tests**

Run: `pnpm --filter api test jobs`
Expected: PASS.

- [ ] **Step 5: Implement `listRankedJobs`**

Read the single profile. If it does not exist, return an empty page with `lastSyncedAt: null`.

Query from `match`:
- inner join `job` on `match.jobId = job.id`
- left join `jobAction` on `jobAction.jobId = job.id AND jobAction.userId = SINGLE_USER_ID`
- `match.candidateId = SINGLE_CANDIDATE_ID`
- `match.excluded = false`
- `match.score >= jobProfile.minMatchScore`
- `jobAction.status IS NULL OR jobAction.status <> 'hidden'`
- search: `job.title ILIKE %q% OR job.company ILIKE %q%` when `q` is non-empty
- salary floor, only when `salaryMin` is set:
  - hide rows where `job.salaryCurrency = profile.salaryCurrency` and `coalesce(job.salaryMax, job.salaryMin) < profile.salaryMin`
  - when `hideUndisclosedSalary` is true, also hide rows where `job.salaryMin IS NULL`
  - rows in another currency are not numerically compared
- order by `match.score DESC` for `match`, or `job.postedAt DESC` for `newest`
- `limit(pageSize).offset((page - 1) * pageSize)`

Run the count query with the same filters. Read `lastSyncedAt` from `jobSource` where `key = "dou"`.

- [ ] **Step 6: Implement `setJobAction`**

- `status === null`: delete the row for `(SINGLE_USER_ID, jobId)`.
- otherwise: `insert(jobAction).values(...).onConflictDoUpdate({ target: [jobAction.userId, jobAction.jobId], set: { status, updatedAt: new Date() } })`.

Both paths are idempotent. The unique index makes concurrent last-write-wins.

- [ ] **Step 7: Implement routes and mount**

`GET /` parses `c.req.query()` and returns the page. `POST /:id/action` validates `JobActionPayload`, checks the job id is a UUID, calls `setJobAction`, and returns `{ status }`. On invalid input return 400.

Mount at `/api/jobs`.

- [ ] **Step 8: Add integration tests gated on `DATABASE_URL`**

Add tests that seed one job/match/profile, then:
- `GET /api/jobs` returns the job with a numeric score.
- `POST /api/jobs/:id/action` with `saved` then `null` round-trips.
- Two concurrent `hidden` writes return 200 both times and leave one row.

- [ ] **Step 9: Run the suite**

Run: `pnpm --filter api test jobs`
Expected: PASS; integration tests skip without `DATABASE_URL`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/features/jobs apps/api/src/index.ts apps/api/tests/features/jobs
git commit -m "feat(jobs): ranked list and action api"
```

---

## Task 9: Exclusions, levels, and scoring

**Files:**
- Create: `apps/api/src/features/matching/exclusions.ts`
- Create: `apps/api/src/features/matching/levels.ts`
- Create: `apps/api/src/features/matching/score.ts`
- Test: `apps/api/tests/features/matching/exclusions.test.ts`
- Test: `apps/api/tests/features/matching/score.test.ts`

**Interfaces:**
- Consumes: `NormalizedJob`, `CandidateSelect`, `JobProfileSelect`
- Produces:
  - `MATCH_WEIGHTS = { technology: 40, location: 30, seniority: 20, compensation: 10 }`
  - `checkExclusions(job, patterns): ExclusionHit[]` where `ExclusionHit = { pattern, field: "title" | "company" | "description", matchedText }`
  - `detectLevel(title): string | null`
  - `scoreJob(job, candidate, profile): MatchResult`

`MatchResult = { score, matchedSignals, missingSignals, excluded, exclusionReasons, explanation }`.

- [ ] **Step 1: Write the failing exclusion and level tests**

Create `apps/api/tests/features/matching/exclusions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkExclusions } from "../../../src/features/matching/exclusions";
import { detectLevel } from "../../../src/features/matching/levels";

const job = {
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote (Ukraine)",
  isRemote: true,
  description: "We build crypto accounting tools in React.",
  postedAt: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postingUrl: "https://x",
};

describe("checkExclusions", () => {
  it("reports field and matched text", () => {
    expect(checkExclusions(job, ["crypto"])).toEqual([
      { pattern: "crypto", field: "description", matchedText: "crypto" },
    ]);
  });

  it("checks title and company", () => {
    expect(checkExclusions({ ...job, title: "Casino Frontend Engineer" }, ["casino"])[0].field).toBe("title");
    expect(checkExclusions({ ...job, company: "Blockchain Labs" }, ["blockchain"])[0].field).toBe("company");
  });

  it("ignores empty patterns", () => {
    expect(checkExclusions(job, [""])).toEqual([]);
  });
});

describe("detectLevel", () => {
  it("finds levels", () => {
    expect(detectLevel("Junior Frontend Engineer")).toBe("Junior");
    expect(detectLevel("Mid-level React Developer")).toBe("Middle");
    expect(detectLevel("Middle+ Frontend Developer")).toBe("Middle");
    expect(detectLevel("Strong Junior-Middle Developer")).toBe("Strong Junior-Middle");
    expect(detectLevel("Staff Frontend Architect")).toBe("Staff");
  });

  it("returns null when absent", () => {
    expect(detectLevel("Software Engineer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test exclusions`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement exclusions and levels**

`exclusions`: case-insensitive substring over title, company, description. Return every hit with field and matched substring. Skip empty patterns. Do not match `postingUrl`. Record the known substring false-positive limitation in a comment.

`levels`: check `Strong Junior-Middle` before `Junior` and `Middle`. Treat `mid`, `middle`, `intermediate`, and `middle+` as `Middle`. Recognize `Trainee`, `Junior`, `Middle`, `Senior`, `Staff`, `Lead`, `Principal`. Return `null` when none match.

- [ ] **Step 4: Run the exclusion tests**

Run: `pnpm --filter api test exclusions`
Expected: PASS.

- [ ] **Step 5: Write the failing scoring tests**

Create `apps/api/tests/features/matching/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scoreJob } from "../../../src/features/matching/score";

const job = {
  title: "Junior Frontend Engineer",
  company: "Acme",
  location: "Remote (Ukraine)",
  isRemote: true,
  description: "React and TypeScript",
  postedAt: null,
  salaryMin: 1000,
  salaryMax: 1500,
  salaryCurrency: "USD",
  postingUrl: "https://x",
};

const candidate = {
  id: "c1",
  tenantId: "default",
  name: "Alex",
  email: "a@b.c",
  headline: null,
  summary: "",
  location: "",
  timezone: "",
  experience: [],
  skills: [],
  technologies: ["React", "TypeScript"],
  education: [],
  languages: [],
  cvUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const profile = {
  id: "p1",
  tenantId: "default",
  candidateId: "c1",
  desiredRoles: ["Frontend Engineer"],
  locations: [{ country: "Ukraine", remoteOnly: true }],
  workModes: ["Remote (Ukraine)"],
  salaryMin: 500,
  salaryMax: null,
  salaryCurrency: "USD",
  preferredTechnologies: ["React", "TypeScript"],
  exclusionPatterns: [],
  positionLevels: ["Junior", "Middle"],
  minMatchScore: 75,
  hideUndisclosedSalary: false,
  updatedAt: new Date(),
};

describe("scoreJob", () => {
  it("scores 100 when all four components match", () => {
    const r = scoreJob(job, candidate as never, profile as never);
    expect(r.score).toBe(100);
    expect(r.excluded).toBe(false);
  });

  it("gives zero tech points for an empty technology list and never NaN", () => {
    const r = scoreJob(job, candidate as never, {
      ...profile,
      preferredTechnologies: [],
    } as never);
    expect(r.score).toBe(60);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  it("returns zero when the target role does not match", () => {
    const r = scoreJob({ ...job, title: "Data Analyst" }, candidate as never, profile as never);
    expect(r.score).toBe(0);
    expect(r.explanation).toContain("Target role not matched");
  });

  it("matches React.js Developer against a React Developer target role", () => {
    const r = scoreJob(
      { ...job, title: "React.js Developer" },
      candidate as never,
      { ...profile, desiredRoles: ["React Developer"] } as never,
    );
    expect(r.score).toBeGreaterThan(0);
  });

  it("returns zero and flags exclusions", () => {
    const r = scoreJob(job, candidate as never, {
      ...profile,
      exclusionPatterns: ["react"],
    } as never);
    expect(r.score).toBe(0);
    expect(r.excluded).toBe(true);
  });

  it("loses 10 points when salary is undisclosed", () => {
    const r = scoreJob(
      { ...job, salaryMin: null, salaryMax: null, salaryCurrency: null },
      candidate as never,
      profile as never,
    );
    expect(r.score).toBe(95);
  });

  it("loses 20 points when the seniority is outside the target levels", () => {
    const r = scoreJob({ ...job, title: "Senior Frontend Engineer" }, candidate as never, profile as never);
    expect(r.score).toBe(80);
  });

  it("does not match React inside Reactive", () => {
    const r = scoreJob(
      { ...job, description: "Reactive programming" },
      candidate as never,
      { ...profile, preferredTechnologies: ["React"] } as never,
    );
    expect(r.matchedSignals).not.toContain("React");
  });

  it("never exceeds 100", () => {
    expect(scoreJob(job, candidate as never, profile as never).score).toBeLessThanOrEqual(100);
  });

  it("builds a short match rationale from the signals", () => {
    const r = scoreJob(job, candidate as never, profile as never);
    expect(r.explanation).toContain("Matches React");
    expect(r.explanation).toContain("Remote");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter api test score`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `score.ts`**

Apply the spec rules:

- **Role gate:** normalize the title and each desired role to lowercase alphanumeric tokens. Treat `fullstack` as `full stack`. Ignore generic grade/function tokens (`engineer`, `developer`, `senior`, `junior`, `middle`, `lead`, `staff`, `principal`). A role matches when every remaining role token appears in the title. If no role matches, return `0` with explanation `Target role not matched`. This makes `React.js Developer` match `React Developer` and `Frontend Developer` match `Frontend Engineer`.
- **Technology 40:** token-boundary match of each preferred technology in `title + description`. Empty list gives 0. `Math.round(40 * matched / total)`.
- **Location 30:** remote job plus any profile work mode containing `Remote`; otherwise matching country token.
- **Seniority 20:** detected level in `positionLevels` → 20; `null` → 10; detected outside → 0.
- **Compensation 10:** no salary preference → 10; listed in profile currency → 10; undisclosed or another currency → 5.
- **Exclusions:** if `checkExclusions` returns hits, score 0, `excluded: true`, include reasons.
- Build `matchedSignals` and `missingSignals` with human labels (`React`, `Remote`, `Junior`, `Salary listed`).
- Build `explanation` as a plain template, never prose generation: `Matches ${matchedSignals.join(", ")}.` plus ` Missing ${missingSignals.join(", ")}.` when there are gaps. Role mismatch stays `Target role not matched`; exclusions use their reason list. The Jobs card clamps this to two lines. Empty explanation is allowed so the UI can fall back to the description.
- Clamp to `0..100`. Never return `NaN`.
- No I/O.

- [ ] **Step 8: Run the scoring tests**

Run: `pnpm --filter api test score`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/features/matching/exclusions.ts apps/api/src/features/matching/levels.ts apps/api/src/features/matching/score.ts apps/api/tests/features/matching
git commit -m "feat(matching): design-weighted job scoring"
```

---

## Task 10: Matching run and routes

**Files:**
- Create: `apps/api/src/features/matching/matching.repo.ts`
- Create: `apps/api/src/features/matching/matching.routes.ts`
- Create: `apps/api/src/features/matching/index.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/tests/features/matching/matching.test.ts`

**Interfaces:**
- Consumes: `scoreJob`, profile repo, `job`, `match`, `Db`
- Produces:
  - `runMatching(db: Db, limit = 50): Promise<{ scored: number; excluded: number }>`
  - HTTP `POST /api/matching/run`

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/tests/features/matching/matching.test.ts`, `describe.skipIf(!process.env.DATABASE_URL)`:

1. Seed a profile and one job, run `runMatching`, then `GET /api/jobs` and assert the job has a numeric score.
2. Run `runMatching` twice and assert the match count stays at 1.
3. Run with `limit: 1` against two jobs and assert only one is scored per call.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test matching`
Expected: FAIL or skip.

- [ ] **Step 3: Implement `runMatching`**

Load the single profile; throw `profile_not_found` when absent. Select at most `limit` jobs left-joined to the candidate's match, ordered by `match.computedAt` ascending with nulls first. Score each. Upsert with `db.batch([...])`:

```ts
db.insert(match)
  .values({ id: crypto.randomUUID(), candidateId: SINGLE_CANDIDATE_ID, jobId, ...result })
  .onConflictDoUpdate({
    target: [match.candidateId, match.jobId],
    set: { score, matchedSignals, missingSignals, excluded, exclusionReasons, explanation, computedAt: new Date() },
  })
```

Wrap each job in try/catch so one bad row increments nothing but does not abort the batch. Return `{ scored, excluded }`.

- [ ] **Step 4: Implement the route**

`POST /api/matching/run` calls `runMatching(db, 50)` and returns the counts. Mount at `/api/matching`.

- [ ] **Step 5: Run the test**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api test matching`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/matching apps/api/src/index.ts apps/api/tests/features/matching/matching.test.ts
git commit -m "feat(matching): batched matching run"
```

---

## Task 11: Web foundation — tokens, shell, primitives, API client

**Files:**
- Modify: `apps/web/package.json` — add `vitest`
- Create: `apps/web/vitest.config.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/lib/format.ts`
- Create: `apps/web/lib/format.test.ts`
- Create: `apps/web/lib/profile-defaults.ts`
- Create: `apps/web/lib/api.ts`
- Modify: `apps/web/tsconfig.json` — add `baseUrl` and `@/*` paths
- Create: `apps/web/components/app-shell.tsx`
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/field.tsx`
- Create: `apps/web/components/ui/icons.tsx`
- Create: `apps/web/components/ui/match-badge.tsx`
- Create: `apps/web/components/ui/tag-input.tsx`
- Create: `apps/web/components/ui/toast.tsx`
- Create: `apps/web/components/ui/toggle.tsx`

**Interfaces:**
- Produces:
  - `formatSalary({ salaryMin, salaryMax, salaryCurrency }): string`
  - `formatRelativeDate(value: string | null, now?: Date): string`
  - `jobSnippet({ explanation, description }): string`
  - `getProfile()`, `putProfile(payload)`, `listJobs(params)`, `setJobAction(jobId, status)`, `runDiscovery()`, `runMatching()`, `getSources()`
  - `AppShell`, `Button`, `Field`, `MatchBadge`, `TagInput`, `Toast`, `Toggle`, `Icon`

- [ ] **Step 1: Write the failing format tests**

Create `apps/web/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatRelativeDate, formatSalary, jobSnippet } from "./format";

describe("formatSalary", () => {
  it("formats a range", () => {
    expect(formatSalary({ salaryMin: 6500, salaryMax: 8500, salaryCurrency: "USD" })).toBe(
      "$6,500 – $8,500 / mo",
    );
  });

  it("formats an open range", () => {
    expect(formatSalary({ salaryMin: 5000, salaryMax: null, salaryCurrency: "USD" })).toBe(
      "From $5,000 / mo",
    );
  });

  it("handles undisclosed", () => {
    expect(formatSalary({ salaryMin: null, salaryMax: null, salaryCurrency: null })).toBe(
      "Salary undisclosed",
    );
  });
});

describe("formatRelativeDate", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("formats days", () => {
    expect(formatRelativeDate("2026-10-18T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelativeDate("2026-10-19T12:00:00Z", now)).toBe("Yesterday");
  });
});

describe("jobSnippet", () => {
  it("prefers the match rationale", () => {
    expect(jobSnippet({ explanation: "Matches React, Remote.", description: "Raw DOU text" })).toBe(
      "Matches React, Remote.",
    );
  });

  it("falls back to the description, then a stable empty string", () => {
    expect(jobSnippet({ explanation: "", description: "Raw DOU text" })).toBe("Raw DOU text");
    expect(jobSnippet({ explanation: "", description: "" })).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test`
Expected: FAIL — scripts/config missing.

- [ ] **Step 3: Add the web test harness**

Add `"test": "vitest run"` and `vitest` devDependency to `apps/web/package.json`. Create `apps/web/vitest.config.ts` with `include: ["lib/**/*.test.ts"]`, `environment: "node"`. Run `pnpm install`.

- [ ] **Step 4: Implement `format.ts`**

Use `Intl.NumberFormat("en-US")`, currency symbols (`USD` → `$`, `EUR` → `€`, otherwise the currency code), and `Intl.RelativeTimeFormat`.

Rules:
- no salary → `Salary undisclosed`
- min and max → `$6,500 – $8,500 / mo`
- min only → `From $5,000 / mo`
- max only → `Up to $8,500 / mo`
- relative date: `Today`, `Yesterday`, `N days ago`, `N weeks ago`, then `MMM d`
- `jobSnippet`: trim and return `explanation` when non-empty, otherwise trimmed `description`, otherwise `""`

- [ ] **Step 5: Run the format tests**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 6: Add the `@/*` import alias**

In `apps/web/tsconfig.json`, add `"baseUrl": "."` and `"paths": { "@/*": ["./*"] }` inside `compilerOptions`. This is required because the pages and API client import with `@/lib/...`.

- [ ] **Step 7: Replace `globals.css` with the design tokens**
Use the token block from the refinement spec. Include:
- `color-scheme: light`
- body background `var(--canvas)`, ink `var(--ink)`, Inter stack
- `* { box-sizing: border-box; }`
- `button, input, select, textarea { font: inherit; }`
- focus-visible ring `0 0 0 3px rgb(37 99 235 / 0.15)`
- remove the starter dark-mode media queries and `.imgLight`/`.imgDark`

Every server page that calls the API (`app/page.tsx`, `jobs/page.tsx`, `resume/page.tsx`, `settings/page.tsx`) must export `const dynamic = "force-dynamic";` so `next build` does not try to render them without a running API.

- [ ] **Step 8: Update `layout.tsx`**

Use `Inter` from `next/font/google` with `subsets: ["latin"]`, `variable: "--font-inter"`. Metadata: `title: "Job Hunter"`, `description: "Ranked remote frontend jobs"`. Render `<body className={inter.variable}>{children}</body>`. Do not wrap onboarding in `AppShell` here.

- [ ] **Step 9: Implement `lib/api.ts`**

Use `const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"`. Export `ApiError` with `status` and parsed body. Every helper throws on non-2xx except `getProfile`, which returns `null` on 404.

Types: `ProfileResponse`, `ProfilePayload`, `RankedJob`, `JobsPage`, `JobActionStatus`, `SourceStatus`. Keep `RankedJob` identical to Task 8's response shape.

Functions:
- `getProfile()`
- `putProfile(payload)`
- `listJobs({ page, pageSize, sort, q })`
- `setJobAction(jobId, status)`
- `runDiscovery()`
- `runMatching()`
- `getSources()`

- [ ] **Step 10: Create `profile-defaults.ts`**

Mirror `DEFAULT_SEARCH_PROFILE` from Task 7 for the onboarding form. Add a comment: `ponytail: duplicated in api; extract to a shared package when a second consumer needs it`.

- [ ] **Step 11: Build the shared UI primitives**

- `Button`: variants `primary` (ink fill), `secondary` (white/border), `ghost`, `danger`; sizes `sm`/`md`; `disabled`; `loading` text. Type: `ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ...; size?: ...; loading?: boolean }`.
- `Field`: label, hint, error, children. Use `htmlFor`.
- `MatchBadge`: `{ score: number }`; renders `{score}% Match` in the accent chip.
- `TagInput`: `{ value: string[]; onChange; placeholder; max? }`; Enter or comma adds a tag; backspace removes the last; each tag has a remove button; dedupe case-insensitively.
- `Toggle`: accessible checkbox with label.
- `Toast`: `{ message, actionLabel?, onAction?, onDismiss }`; fixed bottom center; `role="status"`.
- `Icon`: inline SVG paths for `briefcase`, `document`, `sliders`, `search`, `external`, `close`, `bookmark`, `check`, `hide`, `chevron-left`, `chevron-right`, `refresh`, `plus`, `trash`.
- `AppShell`: `{ active: "jobs" | "resume" | "settings"; children }`; header with JH wordmark, nav links, avatar circle; max-width 1200px; responsive.

All components `"use client"` only when they use state or handlers.

- [ ] **Step 12: Verify**

Run: `pnpm --filter web test`
Expected: PASS.

Run: `pnpm --filter web check-types`
Expected: no errors.

Run: `pnpm --filter web lint`
Expected: no warnings.

- [ ] **Step 13: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vitest.config.ts apps/web/app/globals.css apps/web/app/layout.tsx apps/web/lib apps/web/components
git commit -m "feat(web): design tokens, shell, primitives, and api client"
```

---

## Task 12: Onboarding wizard

**Files:**
- Create: `apps/web/app/onboarding/page.tsx`
- Create: `apps/web/app/onboarding/onboarding.module.css`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `putProfile`, `runDiscovery`, `runMatching`, `getProfile`, `DEFAULT_SEARCH_PROFILE`, `TagInput`, `Field`, `Button`, `Toggle`
- Produces: `/onboarding` saves a profile, runs ingest + matching, and routes to `/jobs`.

- [ ] **Step 1: Replace the root page with a redirect**

`apps/web/app/page.tsx` becomes an async server component:

```tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/api";

export default async function Home() {
  const profile = await getProfile();
  redirect(profile ? "/jobs" : "/onboarding");
}
```

If the API is unavailable, redirect to `/onboarding` rather than crashing.

- [ ] **Step 2: Build step 1 — Welcome**

Client component. Two cards:
- **Manual setup — recommended.** Active; `Continue` moves to step 2.
- **Upload résumé.** Disabled; badge `v0.2`; copy `PDF/DOCX parsing is not part of v0.1`.

Below, a three-item “How Job Hunter evaluates vacancies” strip: Ingest DOU, Score, Rank. Use the design's calm card style.

Top header: `JH` wordmark, `Get started • 2 minutes`, step indicator `1 of 2`.

- [ ] **Step 3: Build step 2 — Search preferences**

Top card, read-only: `Primary vacancy source`, `DOU.ua (Jobs Ukraine)`, pill `Verified feed`, copy `Fetch automatically on save — up to 50 postings`. This mirrors the design and sets the expectation before the fetch runs.

Fields:
- `Target titles` — `TagInput`, defaults from `DEFAULT_SEARCH_PROFILE.desiredRoles`, min 1.
- `Core technologies` — `TagInput`, defaults from preferredTechnologies.
- `Work format` — checkboxes `Remote (Ukraine)`, `Remote (Global)`, `Hybrid`, `Office / On-site`; default the two remote options.
- `Minimum monthly salary` — number input, currency select `USD`/`EUR`, default 500 USD.
- `Remove vacancies with undisclosed salary` — `Toggle`, default off.
- `Minimum match score` — range input 50–95, default 75, with live label. Helper: `Filters the Jobs list. Sends no notifications.`

Below the form, a disabled `Or upload résumé instead` link with a `v0.2` label.

Actions: `Back`, `Save preferences & fetch jobs`.

On submit:
1. Disable the button and show `Saving…`.
2. `await putProfile({ jobProfile: {...} })`
3. `await runDiscovery()`
4. `await runMatching()`
5. `router.push("/jobs")`

On error, keep the form values and show the failing step (`Saving profile failed`, `DOU fetch failed`, `Scoring failed`) with the API message. Do not navigate.

- [ ] **Step 4: Redirect completed profiles**

On mount, call `getProfile()`. If a profile exists, replace the route with `/jobs`. Do this after the first render to avoid a hydration warning.

- [ ] **Step 5: Style from the design**

Use the same tokens. Two columns on desktop (8/4 split), single column on mobile. Cards `radius-lg`, 1px border, 24px padding. Step indicator uses small uppercase labels. No heavy shadows.

- [ ] **Step 6: Verify**

Run: `pnpm --filter web check-types`
Expected: no errors.

Run: `pnpm --filter web lint`
Expected: no warnings.

Manual: complete onboarding with a live API; confirm `/jobs` opens and the profile exists.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/onboarding
git commit -m "feat(web): two-step onboarding flow"
```

---

## Task 13: Résumé/profile page

**Files:**
- Create: `apps/web/app/resume/page.tsx`
- Create: `apps/web/app/resume/resume-client.tsx`
- Create: `apps/web/app/resume/resume.module.css`

**Interfaces:**
- Consumes: `getProfile`, `putProfile`, `AppShell`, `Field`, `TagInput`, `Button`
- Produces: `/resume` edits the candidate profile and preserves the existing job profile on save.

- [ ] **Step 1: Build the page shell**

Async server component `page.tsx`:
- `const profile = await getProfile(); if (!profile) redirect("/onboarding");`
- Render `<AppShell active="resume"><ResumeClient initial={profile} /></AppShell>`.

`ResumeClient` lives in `resume-client.tsx` with `"use client"` at the top. A server component cannot share a file with a client component.

- [ ] **Step 2: Build the identity card**

Fields:
- `Name`
- `Email`
- `Headline`
- `Summary` (textarea, 4 rows)
- `Location`
- `Timezone`

Top-right actions: `Save changes` (primary), disabled until dirty; show `Saved` inline after success. Next to it, a disabled `Re-upload PDF` button with a `v0.2` label.

Copy: `Manually maintained profile used to rank and match DOU vacancies.` Do not show “Parsed from PDF”.

- [ ] **Step 3: Build competencies**

- `Technologies` — `TagInput`
- `Skills` — `TagInput`

Tags render as the design's small pills. Show counts.

- [ ] **Step 4: Build experience**

Repeatable entries: `title`, `company`, `startDate`, `endDate`, `summary`. Each row has a trash button. `Add experience` appends an empty entry. Remove is disabled when only one entry exists? No: allow removing all; the profile is valid with no experience.

- [ ] **Step 5: Build education and languages**

Repeatable `degree`, `school`, `years`; repeatable `language`, `level`. These are display-only for scoring but part of the design. Keep the same add/remove pattern.

- [ ] **Step 6: Build the right rail**

- `Matching logic` card: four rows with the design weights (Technology 40%, Remote 30%, Seniority 20%, Compensation 10%). Read-only.
- `Target roles` card: current roles as pills, read-only `Location: Remote in Ukraine` and `Currency: USD` rows, link `Edit in Settings`.
- A disabled `Auto-rank DOU jobs` toggle with a `v0.2` label and copy `Recalculate matches when new vacancies arrive`. v0.1 has no background matching.
- A small note: `Weights are fixed in v0.1.`
- Bottom note: `Vacancies scoring below your minimum match score are hidden from Jobs.` Do not mention an archive tab.

- [ ] **Step 7: Save**

`putProfile({ candidate: {...}, jobProfile: profile.jobProfile })` to preserve search settings. Build the candidate object from the editable fields only; do not spread the database row, because `id`, `tenantId`, and timestamps are not in `CandidatePayload`. On 400, render the API error summary above the Save button. On success, set `dirty = false` and show `Saved`.

- [ ] **Step 8: Verify**

Run: `pnpm --filter web check-types`
Expected: no errors.

Manual: edit name, technologies, and one experience entry; save; reload; values persist. Change a Settings filter; confirm saving Résumé did not overwrite it.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/resume
git commit -m "feat(web): manually maintained resume profile"
```
---

## Task 14: Settings page

**Files:**
- Create: `apps/web/app/settings/page.tsx`
- Create: `apps/web/app/settings/settings-client.tsx`
- Create: `apps/web/app/settings/settings.module.css`

**Interfaces:**
- Consumes: `getProfile`, `putProfile`, `getSources`, `runDiscovery`, `runMatching`, `DEFAULT_SEARCH_PROFILE`, `formatRelativeDate`
- Produces: `/settings` persists all filters and can refresh DOU.

- [ ] **Step 1: Build the shell and load state**

Async server component: fetch profile and sources in parallel; redirect to `/onboarding` when no profile. Render `<AppShell active="settings"><SettingsClient ... /></AppShell>`.

- [ ] **Step 2: Source card**

Show:
- `DOU.ua — Remote jobs in Ukraine`, pill `Active • Primary`
- Endpoint in a monospace-ish muted line: `https://jobs.dou.ua/vacancies/feeds/?category=Front+End&remote=`. This is the RSS feed; do not show the HTML listing URL.
- `Last synced {formatRelativeDate(lastSyncedAt)}`
- `Refresh now` button: runs discovery then matching, shows `Fetched N, inserted N, merged N` and refreshes `lastSyncedAt`.

Show a disabled `Djinni.co` card with `Ready to connect in v0.2`. Disable `Add source`.

- [ ] **Step 3: Role and tech filters**

`Target positions` — TagInput, min 1. `Target technologies` — TagInput. Show counts.

- [ ] **Step 4: Work format and salary**

Checkboxes for the four modes. Salary floor number + currency select. `Remove vacancies with undisclosed salary` toggle. Include helper copy from the design.

- [ ] **Step 5: Match cutoff and exclusions**

- `Minimum match score` — range 50–95, label. Helper: `Hides lower-scoring vacancies from Jobs. Sends no notifications.`
- `Exclusions` — TagInput. Helper: `Jobs whose title, company, or description contain one of these terms are scored zero and hidden.` This section is intentionally not in the design; it is required by v0.1 scoring.

- [ ] **Step 6: Save, reset, and errors**

`Save preferences` calls `putProfile({ jobProfile })` and shows a success toast `Preferences updated`. `Reset to defaults` replaces the form with `DEFAULT_SEARCH_PROFILE` and marks dirty; it does not save until the user clicks Save. On API error, keep values and show an inline banner.

- [ ] **Step 7: Verify**

Run: `pnpm --filter web check-types`
Expected: no errors.

Manual: change roles, tech, work mode, salary, toggle, cutoff, and exclusions; save; reload; values persist. Click Refresh now; jobs list updates.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/settings
git commit -m "feat(web): search preferences settings"
```

---

## Task 15: Jobs list, detail drawer, and actions

**Files:**
- Create: `apps/web/app/jobs/page.tsx`
- Create: `apps/web/app/jobs/jobs-client.tsx`
- Create: `apps/web/app/jobs/jobs.module.css`
- Create: `apps/web/components/job-card.tsx`
- Create: `apps/web/components/job-drawer.tsx`

**Interfaces:**
- Consumes: `listJobs`, `setJobAction`, `runDiscovery`, `runMatching`, `getProfile`, `formatSalary`, `formatRelativeDate`, `jobSnippet`, `AppShell`, `MatchBadge`, `Icon`, `Toast`
- Produces: `/jobs` with search, sort, pagination, drawer, save/applied/hidden actions, and empty/error states.

- [ ] **Step 1: Build the page and data load**

`page.tsx` is an async server component:
- `const profile = await getProfile(); if (!profile) redirect("/onboarding");`
- Render `<AppShell active="jobs"><JobsClient /></AppShell>`.

`JobsClient` lives in `jobs-client.tsx` with `"use client"` at the top. A server component cannot share a file with a client component.

On mount and whenever `page`, `sort`, or `q` changes, call `listJobs`. Use an `AbortController` and ignore aborted requests. Show skeleton cards while loading.

- [ ] **Step 2: Build the header**

- H1 `Jobs`
- Subtitle `Ranked matches based on your profile • DOU.ua remote listings`
- Last sync line from `lastSyncedAt`
- Search input with search icon, placeholder `Filter by title or company…`
- Sort select: `Highest match first`, `Newest first`
- Debounce search by 250ms; reset page to 1 on a new query

- [ ] **Step 3: Build `JobCard`**

Props: `{ job: RankedJob; selected: boolean; onSelect; onAction }`.

Layout:
- Top row: `MatchBadge` left, salary right.
- Title (`h3`).
- Meta: company • location • `formatRelativeDate(postedAt)` + ` on DOU`.
- Two-line clamped `jobSnippet(job)`. This is the match rationale from `match.explanation`, with the description as fallback.
- Up to three tag pills from `matchedSignals` filtered to technology labels; if none, use `missingSignals`.
- Footer: `Mark as applied` (or `Applied ✓`), `Hide`, `View on DOU.ua` external link. Stop propagation on footer clicks.
- Selected: `border-color: var(--primary)`, `background: var(--accent-soft)`.

- [ ] **Step 4: Build the drawer `JobDrawer`**

Props: `{ job: RankedJob | null; onClose; onAction }`.

Content:
- Header: score badge, title, salary, company/location/date, close button.
- Actions: `Save` / `Saved`, `Mark as applied`, `Hide`, `View on DOU.ua`.
- `Matching competencies`: matchedSignals as check pills.
- `Gaps`: missingSignals as muted pills. Empty state `No gaps found`.
- `Job overview`: `job.description` rendered as plain text with `white-space: pre-wrap`; never `dangerouslySetInnerHTML`.
- If `excluded`, show exclusion reasons in a red-tinted note. Excluded jobs are normally hidden from the list, but the drawer supports them if a future view passes one.

Accessibility:
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
- Focus the close button on open; restore the previously focused card on close.
- Escape closes.
- Lock body scroll while open.
- Overlay click closes.
- On `<1024px`, the drawer is full-screen; on desktop it is a 520px right panel.

- [ ] **Step 5: Implement actions and optimistic updates**

`onAction(jobId, status)`:
1. Update the local item immediately.
2. Call `setJobAction`.
3. On failure, restore the previous item and show an error toast.

`hidden` removes the job from the current list and decrements `total`. Show `Toast` with `Undo` for 5 seconds; Undo calls `setJobAction(jobId, null)` and refetches the page. `saved` and `applied` update the card and drawer in place.

- [ ] **Step 6: Build pagination**

- Page size 6.
- Previous/next buttons disabled at the bounds.
- Numbered pages with ellipsis when `totalPages > 7`.
- `Showing 1–6 of 24` label.
- Scroll to top on page change.

- [ ] **Step 7: Build empty, error, and loading states**

- Empty: `No ranked jobs yet`, copy `Fetch new DOU listings and score them against your profile.`, buttons `Fetch jobs` and `Run scoring`. Run both in sequence, then refetch.
- Error: inline red banner with `Retry`.
- Loading: 6 skeleton cards with the same dimensions.
- No profile: server redirect handles it; do not render a blank page.

- [ ] **Step 8: Responsive layout**

- `>=1024px`: two-column card grid, 24px gap, drawer 520px.
- `768–1023px`: two columns, tighter gap, drawer full-screen.
- `<768px`: one column, header stacks, search full width, drawer full-screen, pagination wraps.

- [ ] **Step 9: Verify**

Run: `pnpm --filter web check-types`
Expected: no errors.

Run: `pnpm --filter web lint`
Expected: no warnings.

Manual checklist:
- Search filters the list and resets to page 1.
- Sort changes order.
- Pagination matches the total.
- Drawer opens, Escape closes, focus returns to the card.
- Save, Apply, Hide persist after reload.
- Hide shows Undo; Undo restores the job.
- Empty and error states render.
- No AI tailoring or cover-letter buttons exist.

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/jobs apps/web/components/job-card.tsx apps/web/components/job-drawer.tsx
git commit -m "feat(web): ranked jobs list, drawer, and actions"
```

---

## Task 16: README and definition of done

**Files:**
- Modify: `README.md`
- Modify: `apps/web/.env.example` (create if missing)

**Interfaces:**
- Consumes: nothing
- Produces: setup instructions that match this repo.

- [ ] **Step 1: Rewrite `README.md`**

Include:
- What Job Hunter does.
- Prerequisites: Node 24, pnpm 12, free Cloudflare account, free Neon project. Neither requires a credit card.
- `pnpm install`
- Create `apps/api/.dev.vars` from `.dev.vars.example`.
- Create `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8787`.
- Run the migration.
- Start: `pnpm turbo run dev`.
- First run: open `http://localhost:3000`, complete onboarding.
- Architecture summary: Next.js web → Hono Worker → Neon; DOU RSS adapter; pure scoring; no AI in v0.1.
- The $0/month cost note.
- Links to both specs and this plan.

Do not mention a paid plan, tier, or upgrade.

- [ ] **Step 2: Verify the documented commands**

Run each command from a clean shell. Fix the README if any command is wrong.

- [ ] **Step 3: Commit**

```bash
git add README.md apps/web/.env.example
git commit -m "docs: replace starter readme with real setup"
```

---

## Task 17: Align the search-query reference

**Files:**
- Modify: `docs/superpowers/queries/job-search-v0.1.markdown`

**Interfaces:**
- Consumes: the refined spec
- Produces: a reference that no longer promises sources, parsing, or tailoring that v0.1 does not have.

- [ ] **Step 1: Rewrite the query reference**

Keep it short. State:
- DOU.ua RSS is the only v0.1 source. Djinni, ATS, GitHub, and company pages are v0.2.
- The profile is manual. No PDF/DOCX upload or parsing.
- Remote Ukraine first, salary floor in USD, levels Trainee through Strong Junior-Middle.
- Exclusions apply to title, company, and description.
- No AI tailoring and no cover-letter generation in v0.1.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/queries/job-search-v0.1.markdown
git commit -m "docs: align search query reference with v0.1 scope"
```

---

## Definition of Done

- `pnpm turbo run test` passes with no database configured; integration tests skip cleanly.
- `pnpm turbo run test` passes with `DATABASE_URL` set; integration tests run.
- `pnpm turbo run check-types` and `pnpm turbo run lint` pass.
- First run routes to `/onboarding`; completing it ingests DOU jobs, scores them, and opens `/jobs`.
- `/jobs` shows the design's cards, match badges, match-rationale snippets, drawer, search, sort, and pagination.
- `POST /api/discovery/run` twice reports `inserted: N` then `inserted: 0, merged: N`.
- Save/apply/hide survive reloads; hide has a working Undo.
- `/resume` saves a manual profile without claiming PDF provenance, shows read-only location/currency, and disables auto-rank and re-upload.
- `/settings` persists every filter, shows the RSS feed endpoint, and refreshes DOU.
- Onboarding shows the DOU source card and calls the cutoff `Minimum match score`, never “notification cutoff”.
- No AI provider call, queue binding, PDF parser, cover-letter code, or tailoring code exists anywhere in the tree.
- No setup step, README line, or config file requires a paid plan. The project runs at $0/month.
