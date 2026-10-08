# Job Hunter v0.1 Implementation Plan (Profiles → Discovery → Matching)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user web app where the owner records their Candidate profile and Job Search Profile, ingests jobs from one external source, and sees a ranked list of jobs scored against their profile.

**Architecture:** Monolith. Hono API on Cloudflare Workers talking to Neon over the `@neondatabase/serverless` HTTP driver; Next.js 16 App Router frontend. All normalization, fingerprinting, exclusion matching and scoring are pure functions, unit-tested with no database or network. External job sources sit behind a `JobSourceAdapter` port with a keyless public API as the first implementation, so swapping sources touches one file.

**Tech Stack:** TypeScript 7, Hono 4, Cloudflare Workers (wrangler), Drizzle ORM `1.0.0-rc.4` (`neon-http` driver, `pg-core` tables), ArkType 2 (via `drizzle-orm/arktype`), Neon PostgreSQL, Next.js 16 / React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-job-hunter-architecture-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **The project must run entirely on free tiers at $0/month.** No task may require, document, or assume a paid plan. If a step would instruct the user to enable a paid tier, that step is wrong.
- Workers Free allows only **10ms CPU per invocation** and kills an invocation that exceeds it. Keep per-request work proportional to a single job batch, not the whole catalog.
- Neon Free caps storage at **1 GB per project**, with `source_job.raw` as the growth driver. No task may add unbounded storage.
- No microservices, event bus, CQRS, or complex enterprise patterns.
- Single-user MVP. Every table carries `tenantId`; it is written as a constant, never enforced, never read by business logic.
- v0.1 contains **no AI provider call and no queue**. Analysis, tailoring and the Cloudflare Queue land in v0.2. Do not add an AI SDK, a queue binding, or a retry/dead-letter mechanism in this plan.
- No cover-letter generation. No CV/resume parsing — candidate skills are entered manually.
- Drizzle is pinned at `1.0.0-rc.4`. Its API is verified against the installed package, **not** against 0.x documentation found online.
- ArkType is the only runtime validator. Do not add zod, valibot, or typebox.
- `dotenv` is inert on Workers and must not be used. Local secrets live in `apps/api/.dev.vars`; deployed secrets use `wrangler secret put`.
- Source-specific payloads never touch the canonical `Job` columns. Raw payloads go only to `source_job.raw`.
- Provider adapters are validated with ArkType at the port boundary before anything reaches a pure function.

## Review Focus

Five input classes the spec implies but which no task's happy-path test exercises. Each has its test assigned to the owning task below.

1. **Source returns a job with a null/missing salary or location** (`apps/api/src/features/discovery/normalize.ts` — Task 6). Real feeds routinely omit these. Normalization must substitute empty/zero values and never throw, so a single malformed row cannot abort a whole ingest batch.
2. **Two genuinely different jobs with identical title, company and location** (Task 6 — `fingerprint`). These are separate openings at the same company. Deduplication must not merge them, because a merged job silently hides a vacancy.
3. **Exclusion terms appearing in the company name or an unrelated sentence** (`apps/api/src/features/matching/exclusions.ts` — Task 9). "Crypto" in "we build crypto accounting tools" is a real match; "crypto" as part of a company named "Blockchain Labs" is not. Matching must report which term matched and where, not just a boolean.
4. **Candidate profile with an empty technology list** (`apps/api/src/features/matching/score.ts` — Task 9). An empty list is valid (profile still being filled in). Scoring must return 0 rather than `NaN`, which is what dividing by zero produces.
5. **Concurrent ingest of the same job from two sources** (`apps/api/src/features/discovery/ingest.ts` — Task 7). Both batches see no existing row and both insert. The unique constraint must reject the loser; the ingest must catch it and continue, not abort the batch.

---

## File Structure

```
apps/api/src/
  db/
    schema.ts            # pgTable definitions + derived arktype schemas
    client.ts            # drizzle(neon-http) factory, reads DATABASE_URL from env
    index.ts             # re-exports
  features/
    profiles/
      profiles.types.ts   # explicit arktype types for jsonb columns
      profiles.repo.ts   # data access for candidate + job_profile
      profiles.routes.ts # GET/PUT /api/profile
      profiles.service.ts# read/update orchestration
    discovery/
      source.ts          # JobSourceAdapter port + RawJob types
      adapters/
        remotive.ts      # first concrete adapter (keyless public API)
      normalize.ts       # PURE: raw -> canonical NormalizedJob
      fingerprint.ts     # PURE: canonical -> dedup fingerprint hash
      ingest.ts          # orchestration: adapter -> normalize -> dedup -> persist
      discovery.repo.ts  # data access for job, source_job, job_source
      discovery.routes.ts# POST /api/discovery/run, GET /api/jobs
    matching/
      exclusions.ts      # PURE: does this job violate the profile's exclusions?
      score.ts           # PURE: candidate + job -> MatchResult
      matching.repo.ts   # persists match rows
      matching.routes.ts # POST /api/matching/run, GET /api/matches
  index.ts                # Hono app, mounts routes, /health endpoint

apps/api/tests/           # vitest tests mirroring src/ paths
```

Tests live in `apps/api/tests/`, not beside sources, so `src/` stays free of test files.

---

## Task 1: Vitest test harness

No test runner exists. Nothing after this task can follow TDD until this lands.

**Files:**
- Modify: `apps/api/package.json` — add `test` script and `vitest` devDependency
- Modify: `turbo.json` — add `test` task
- Create: `apps/api/vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm --filter api test` runs the api suite; `pnpm test` at root runs all suites

- [ ] **Step 1: Add vitest as a devDependency and add the test script**

In `apps/api/package.json`, add to `devDependencies`: `"vitest": "^3.2.4"`. Add to `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Add a smoke test that proves the runner works**

Create `apps/api/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Create the vitest config**

Create `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `pnpm --filter api test`
Expected: PASS, 1 test.

- [ ] **Step 5: Add the `test` task to turbo.json**

In `turbo.json`, add alongside the existing `lint` task:

```json
"test": {
  "dependsOn": ["^test"]
}
```

- [ ] **Step 6: Remove the dead `dotenv` dependency**

In `apps/api/package.json`, remove `"dotenv": "^18.0.6"` from `dependencies`. It is inert on Cloudflare Workers and the Global Constraints forbid its use. Run `pnpm install` to update the lockfile.

- [ ] **Step 7: Verify the root task reaches the api suite**

Run: `pnpm turbo run test`
Expected: PASS, 1 test, `api` task reported.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/tests/smoke.test.ts pnpm-lock.yaml turbo.json
git commit -m "test: add vitest harness to api"
```

---

## Task 2: Canonical schema and derived validators

**Files:**
- Create: `apps/api/src/db/schema.ts`
- Test: `apps/api/tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - Tables: `jobSource`, `sourceJob`, `job`, `candidate`, `jobProfile`, `match`
  - Validators: `JobInsert`, `JobSelect`, `CandidateInsert`, `CandidateSelect`, `JobProfileInsert`, `JobProfileSelect`, `MatchInsert`, `MatchSelect`, `SourceJobInsert` — all arktype types, produced by `createInsertSchema` / `createSelectSchema` from `drizzle-orm/arktype`
  - Constants: `DEFAULT_TENANT_ID` (the string `"default"`), `SINGLE_USER_ID` (the string `"single-user"`)

**Schema decisions fixed by this plan** (do not re-invent):

- Every table has `tenantId: text('tenant_id').notNull().default(DEFAULT_TENANT_ID)`.
- `job`: `id` uuid PK default random, `title` text notNull, `company` text notNull, `companyUrl` text, `location` text notNull default `''`, `isRemote` boolean notNull default false, `description` text notNull default `''`, `postedAt` timestamp, `salaryMin` integer, `salaryMax` integer, `salaryCurrency` text, `postingUrl` text, `fingerprint` text notNull, `sourceJobCount` integer notNull default 1, `createdAt`/`updatedAt` timestamp notNull default now.
- `job.fingerprint` is a `text` column holding a hex digest string (a `sha256` hex string is 64 characters, which `varchar(64)` would fit exactly; `text` is chosen so a future hash change needs no migration). It gets a unique index — this is what makes Task 7's concurrency check work.
- `job` gets an index on `fingerprint` and on `postedAt`.
- `sourceJob`: `id` uuid PK, `jobId` uuid notNull FK→`job.id`, `sourceId` uuid notNull FK→`job_source.id`, `externalId` text notNull, `raw` jsonb notNull, `fetchedAt` timestamp notNull default now. Unique index on `(sourceId, externalId)`.
- `jobSource`: `id` uuid PK, `key` text notNull unique, `name` text notNull, `integrationType` text notNull (`'api' | 'scraper' | 'upload'`), `lastSyncedAt` timestamp.
- `candidate`: `id` uuid PK, `name` text notNull, `email` text notNull, `headline` text, `experience` jsonb notNull default `'[]'`, `skills` jsonb notNull default `'[]'`, `technologies` jsonb notNull default `'[]'`, `cvUrl` text, `createdAt`/`updatedAt`.
- `jobProfile`: `id` uuid PK, `candidateId` uuid notNull FK→`candidate.id`, `desiredRoles` jsonb notNull default `'[]'`, `locations` jsonb notNull default `'[]'`, `workModes` jsonb notNull default `'[]'`, `salaryMin` integer, `salaryMax` integer, `salaryCurrency` text default `'USD'`, `preferredTechnologies` jsonb notNull default `'[]'`, `exclusionPatterns` jsonb notNull default `'[]'`, `positionLevels` jsonb notNull default `'[]'`, `updatedAt`.
- `match`: `id` uuid PK, `candidateId` uuid notNull FK, `jobId` uuid notNull FK, `score` integer notNull, `matchedSignals` jsonb notNull default `'[]'`, `missingSignals` jsonb notNull default `'[]'`, `excluded` boolean notNull default false, `exclusionReasons` jsonb notNull default `'[]'`, `explanation` text notNull default `''`, `computedAt` timestamp notNull default now. Unique index on `(candidateId, jobId)`.

- [ ] **Step 1: Write the failing test for derived validators**

Create `apps/api/tests/db/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { job, candidate } from "../../src/db/schema";
import { type } from "arktype";
import { JobInsert } from "../../src/db/schema";

describe("derived arktype schemas", () => {
  it("rejects a job insert with no title", () => {
    const result = JobInsert({
      tenantId: "default",
      company: "Acme",
      fingerprint: "abc",
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a negative salary", () => {
    const result = JobInsert({
      tenantId: "default",
      title: "Frontend Engineer",
      company: "Acme",
      fingerprint: "abc",
      salaryMin: -5,
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts a well-formed job insert", () => {
    const result = JobInsert({
      tenantId: "default",
      title: "Frontend Engineer",
      company: "Acme",
      fingerprint: "abc",
      isRemote: true,
    });
    expect(result instanceof type.errors).toBe(false);
  });
});
```

Add `import { type } from "arktype";` at the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test schema`
Expected: FAIL — cannot resolve `../../src/db/schema`.

- [ ] **Step 3: Implement `apps/api/src/db/schema.ts`**

Define `DEFAULT_TENANT_ID`, `SINGLE_USER_ID`, the six tables exactly as specified above using `pgTable` from `drizzle-orm/pg-core`, `text`, `boolean`, `integer`, `timestamp`, `uuid`, `jsonb` from `drizzle-orm/pg-core`, and `sql` from `drizzle-orm`. Add the unique index on `job.fingerprint`, the plain index on `job.postedAt`, the unique index on `sourceJob (sourceId, externalId)`, the unique index on `match (candidateId, jobId)`, and the unique constraint on `jobSource.key`.

Export the derived validators from `drizzle-orm/arktype`:

```ts
export const JobInsert = createInsertSchema(job);
export const JobSelect = createSelectSchema(job);
export const CandidateInsert = createInsertSchema(candidate);
export const CandidateSelect = createSelectSchema(candidate);
export const JobProfileInsert = createInsertSchema(jobProfile);
export const JobProfileSelect = createSelectSchema(jobProfile);
export const MatchInsert = createInsertSchema(match);
export const MatchSelect = createSelectSchema(match);
export const SourceJobInsert = createInsertSchema(sourceJob);
```

Add `.$type<number>()` or an equivalent arktype refinement to `salaryMin` and `salaryMax` so negative values are rejected, since `createInsertSchema` otherwise infers a bare `integer` that accepts negatives.

The `import { type } from "arktype";` line at the top of the test file is required — `type.errors` is how arktype signals a validation failure.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test schema`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify types compile**

Run: `pnpm --filter api exec tsc --noEmit`
Expected: no errors. If `@cloudflare/workers-types` is missing, add it as a devDependency.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/tests/db/schema.test.ts
git commit -m "feat(db): canonical schema with derived arktype validators"
```

---

## Task 3: Migrations and the Neon client

**Files:**
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/.dev.vars.example`
- Modify: `apps/api/.gitignore`
- Create: `apps/api/src/db/client.ts`
- Test: `apps/api/tests/db/client.test.ts`

**Interfaces:**
- Consumes: tables from Task 2
- Produces: `createDb(connectionString: string): NeonHttpDatabase` in `src/db/client.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/db/client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../../src/db/client";
import { job } from "../../src/db/schema";

describe("createDb", () => {
  it("builds a queryable instance without connecting", async () => {
    const db = createDb("postgresql://user:pass@host/db");
    const query = db.select().from(job);
    expect(query).toBeDefined();
  });
});
```

This test deliberately never executes the query — it proves the client constructs and that the table reference is wired, without needing a live database.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test client`
Expected: FAIL — cannot resolve `../../src/db/client`.

- [ ] **Step 3: Implement `src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  return drizzle(connectionString, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 4: Run it to verify it passes**

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

- [ ] **Step 6: Document the local secret file and ignore it**

Create `apps/api/.dev.vars.example` containing exactly:

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

Append `.dev.vars` to `apps/api/.gitignore` if it is not already present.

- [ ] **Step 7: Generate the initial migration**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api exec drizzle-kit generate`
Expected: a `drizzle/` directory with `0000_*.sql` containing all six tables.

If the pinned `drizzle-kit` RC rejects the config shape, read the installed `drizzle-kit`'s expected config rather than consulting online 0.x docs, and adjust `drizzle.config.ts` only.

- [ ] **Step 8: Commit**

```bash
git add apps/api/drizzle.config.ts apps/api/.dev.vars.example apps/api/.gitignore apps/api/src/db/client.ts apps/api/tests/db/client.test.ts apps/api/drizzle
git commit -m "feat(db): neon client and initial migration"
```

---

## Task 4: Candidate profile read/update API

**Files:**
- Create: `apps/api/src/features/profiles/profiles.repo.ts`
- Create: `apps/api/src/features/profiles/profiles.service.ts`
- Create: `apps/api/src/features/profiles/profiles.routes.ts`
- Create: `apps/api/src/features/profiles/index.ts`
- Modify: `apps/api/src/index.ts` — mount the router
- Test: `apps/api/tests/features/profiles/profiles.test.ts`

**Interfaces:**
- Consumes: `createDb`, tables and `CandidateInsert` / `JobProfileInsert` from Task 2
- Produces: HTTP `GET /api/profile` and `PUT /api/profile`. `PUT` accepts `{ candidate: {...}, jobProfile: {...} }` and upserts both rows for `SINGLE_USER_ID`. Both routes read `env.DATABASE_URL` via Hono context bindings.

- [ ] **Step 1: Write the failing test for the profile payload validator**

Create `apps/api/tests/features/profiles/profiles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { type } from "arktype";
import { ProfilePayload } from "../../../src/features/profiles/profiles.service";

describe("ProfilePayload", () => {
  it("rejects a payload with no jobProfile", () => {
    const result = ProfilePayload({ candidate: { name: "Alex", email: "a@b.c" } });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects an empty desiredRoles array", () => {
    const result = ProfilePayload({
      candidate: { name: "Alex", email: "a@b.c" },
      jobProfile: { desiredRoles: [] },
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts a payload with roles and technologies", () => {
    const result = ProfilePayload({
      candidate: { name: "Alex", email: "a@b.c", technologies: ["TypeScript"] },
      jobProfile: { desiredRoles: ["Frontend Engineer"], preferredTechnologies: ["TypeScript"] },
    });
    expect(result instanceof type.errors).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test profiles`
Expected: FAIL — cannot resolve the service module.

- [ ] **Step 3: Implement `profiles.service.ts` with the payload type**

Export from `profiles.service.ts`:

```ts
export const ProfilePayload = type({
  candidate: {
    name: "string >= 1",
    email: "string.email",
    headline: "string | null",
    experience: ExperienceEntry.array(),
    skills: "string[]",
    technologies: "string[]",
    cvUrl: "string | null",
  },
  jobProfile: {
    desiredRoles: "string[] >= 1",
    locations: LocationPreference.array(),
    workModes: "string[]",
    salaryMin: "number | null",
    salaryMax: "number | null",
    salaryCurrency: "string",
    preferredTechnologies: "string[]",
    exclusionPatterns: "string[]",
    positionLevels: "string[]",
  },
});

export type ProfilePayloadT = typeof ProfilePayload.infer;
```

Define `ExperienceEntry` and `LocationPreference` in the same file as arktype objects matching the shape already recorded in `docs/superpowers/profiles/default-profile.json` — `ExperienceEntry` is `{ title, company, startDate, endDate, summary }` all strings; `LocationPreference` is `{ country, remoteOnly }`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test profiles`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for the routes**

Add to `profiles.test.ts` a second describe block using `app.request()` from the Hono app imported from `src/index.ts`, asserting that `GET /api/profile` returns `200` with a JSON body, and that `PUT /api/profile` with an invalid payload returns `400` and an error body naming the offending field.

Gate these two route tests behind `describe.skipIf(!process.env.DATABASE_URL)` so the suite stays green without a database, and note in a comment that they are the only tests needing Neon.

- [ ] **Step 6: Implement `profiles.repo.ts`, `profiles.service.ts` orchestration and `profiles.routes.ts`**

`profiles.repo.ts` exports:

```ts
export async function getProfile(db: Db): Promise<{ candidate: CandidateSelect | null; jobProfile: JobProfileSelect | null }>
export async function upsertProfile(db: Db, payload: ProfilePayloadT): Promise<void>
```

`upsertProfile` uses drizzle's `onConflictDoUpdate` against `candidate.id` and `jobProfile.candidateId`, writing `tenantId: DEFAULT_TENANT_ID` and `candidateId: SINGLE_USER_ID`.

`profiles.routes.ts` exports a Hono router with the two routes. `PUT` runs `ProfilePayload(body)`, returns `c.json({ errors: result.summary }, 400)` when the result is a `type.errors`, otherwise calls `upsertProfile` and returns `204`.

`src/index.ts` mounts it at `/api/profile` and keeps the existing `/` route.

- [ ] **Step 7: Run the suite to verify it passes**

Run: `pnpm --filter api test profiles`
Expected: PASS. The 3 validator tests run; the 2 route tests skip when `DATABASE_URL` is unset, and pass when it is set.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/features/profiles apps/api/src/index.ts apps/api/tests/features/profiles
git commit -m "feat(profiles): candidate and job search profile read/update api"
```

---

## Task 5: JobSourceAdapter port and the first adapter

The v0.1 source is **Remotive** (`https://remotive.com/api/remote-jobs`), chosen because it needs no API key, returns clean JSON, and supports filtering by remote. Open question #1 in the spec (priority sources) is deliberately left open — the port exists so this choice is reversible in one file.

**Files:**
- Create: `apps/api/src/features/discovery/source.ts`
- Create: `apps/api/src/features/discovery/adapters/remotive.ts`
- Test: `apps/api/tests/features/discovery/remotive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RawJob` type: `{ externalId: string; title: string; company: string; companyUrl?: string; location: string; isRemote: boolean; description: string; postedAt?: string; salaryMin?: number; salaryMax?: number; salaryCurrency?: string; postingUrl: string; raw: unknown }`
  - `RawJobValidator`: arktype type validating `RawJob`
  - `JobSourceAdapter` interface: `{ key: string; name: string; fetchJobs(): Promise<RawJob[]> }`
  - `remotiveAdapter: JobSourceAdapter`

- [ ] **Step 1: Write the failing test for the validator**

Create `apps/api/tests/features/discovery/remotive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { type } from "arktype";
import { RawJobValidator } from "../../../src/features/discovery/source";

describe("RawJobValidator", () => {
  it("rejects a row with no externalId", () => {
    const result = RawJobValidator({ title: "Dev", company: "Acme" });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a row whose description is a number", () => {
    const result = RawJobValidator({
      externalId: "1",
      title: "Dev",
      company: "Acme",
      location: "",
      isRemote: true,
      description: 42,
      postingUrl: "https://x",
      raw: {},
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("accepts a minimal well-formed row", () => {
    const result = RawJobValidator({
      externalId: "1",
      title: "Dev",
      company: "Acme",
      location: "",
      isRemote: true,
      description: "We use TypeScript.",
      postingUrl: "https://x",
      raw: {},
    });
    expect(result instanceof type.errors).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test remotive`
Expected: FAIL — cannot resolve the source module.

- [ ] **Step 3: Implement `source.ts`**

Define `RawJob` as an arktype object type with `externalId`, `title`, `company` as non-empty strings; `companyUrl`, `salaryMin`, `salaryMax`, `salaryCurrency` optional; `location` a string; `isRemote` a boolean; `description` a string; `postedAt` an optional ISO date string; `postingUrl` a string; `raw` unknown.

Export `RawJobValidator = RawJob` and the `JobSourceAdapter` interface as specified.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test remotive`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for Remotive payload mapping**

Add to `remotive.test.ts` a describe block for `mapRemotiveResponse`, asserting that a fixture shaped like Remotive's real response (`{ jobs: [{ id, title, company_name, candidate_required_location, url, publication_date, description, job_type }] }`) maps to a `RawJob` with `externalId` from `id`, `company` from `company_name`, `isRemote: true`, and the untouched `raw` object. Also assert that a job with `salary` absent yields `salaryMin === undefined` rather than throwing.

Call `mapRemotiveResponse` directly — do not hit the network in tests.

- [ ] **Step 6: Implement `adapters/remotive.ts`**

```ts
export function mapRemotiveResponse(payload: unknown): RawJob[]
export const remotiveAdapter: JobSourceAdapter
```

`mapRemotiveResponse` reads `payload.jobs`, tolerates a missing or non-array `jobs` by returning `[]`, converts Remotive's HTML `description` to plain text with a small regex-based strip of tags, and passes each mapped row through `RawJobValidator`, dropping rows that fail validation rather than throwing.

`remotiveAdapter.fetchJobs` fetches `https://remotive.com/api/remote-jobs?limit=100`, runs `mapRemotiveResponse`, and throws a clear error if the response is not ok.

- [ ] **Step 7: Run the suite to verify it passes**

Run: `pnpm --filter api test remotive`
Expected: PASS, all tests in the file.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/features/discovery/source.ts apps/api/src/features/discovery/adapters/remotive.ts apps/api/tests/features/discovery/remotive.test.ts
git commit -m "feat(discovery): job source port and remotive adapter"
```

---

## Task 6: Normalization and fingerprinting (pure)

The most heavily tested task in the plan, because it carries Review Focus items 1 and 2.

**Files:**
- Create: `apps/api/src/features/discovery/normalize.ts`
- Create: `apps/api/src/features/discovery/fingerprint.ts`
- Test: `apps/api/tests/features/discovery/normalize.test.ts`

**Interfaces:**
- Consumes: `RawJob` from Task 5
- Produces:
  - `normalize(raw: RawJob): NormalizedJob` where `NormalizedJob` is `{ title, company, companyUrl, location, isRemote, description, postedAt: Date | null, salaryMin: number | null, salaryMax: number | null, salaryCurrency: string | null, postingUrl }`
  - `fingerprint(job: NormalizedJob): string` — a hex sha256 of the normalized identity

- [ ] **Step 1: Write the failing tests for the missing-field cases**

Create `apps/api/tests/features/discovery/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalize } from "../../../src/features/discovery/normalize";
import { fingerprint } from "../../../src/features/discovery/fingerprint";

const base = {
  externalId: "1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote",
  isRemote: true,
  description: "React and TypeScript",
  postingUrl: "https://x",
  raw: {},
};

describe("normalize", () => {
  it("survives a row with no location and no salary", () => {
    const out = normalize({ ...base, location: "", salaryMin: undefined });
    expect(out.location).toBe("");
    expect(out.salaryMin).toBeNull();
    expect(out.salaryMax).toBeNull();
    expect(out.postedAt).toBeNull();
  });

  it("trims whitespace and collapses runs of spaces in the title", () => {
    const out = normalize({ ...base, title: "  Frontend   Engineer  " });
    expect(out.title).toBe("Frontend Engineer");
  });

  it("parses an ISO postedAt into a Date", () => {
    const out = normalize({ ...base, postedAt: "2026-01-15T10:00:00Z" });
    expect(out.postedAt).toBeInstanceOf(Date);
  });

  it("does not throw on an unparseable postedAt", () => {
    const out = normalize({ ...base, postedAt: "not-a-date" });
    expect(out.postedAt).toBeNull();
  });
});

describe("fingerprint", () => {
  it("is stable across whitespace-only differences", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, title: "Frontend  Engineer" }));
    expect(a).toBe(b);
  });

  it("is case-insensitive on the title", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, title: "frontend engineer" }));
    expect(a).toBe(b);
  });

  it("collapses two identical postings to one fingerprint", async () => {
    const a = await fingerprint(normalize({ ...base, title: "Frontend Engineer", company: "Acme" }));
    const b = await fingerprint(normalize({ ...base, title: "Frontend Engineer", company: "Acme" }));
    expect(a).toBe(b);
  });

  it("ignores the postingUrl so the same vacancy on two sources collapses", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, postingUrl: "https://y" }));
    expect(a).toBe(b);
  });

  it("distinguishes different companies", async () => {
    const a = await fingerprint(normalize(base));
    const b = await fingerprint(normalize({ ...base, company: "Globex" }));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test normalize`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Implement `normalize.ts`**

Pure function, no I/O, no `Date.now()`. Collapse internal whitespace and trim strings. Map empty strings for `location` to `''`. Map missing salary fields to `null`. Parse `postedAt` with `new Date(...)` inside a try/catch returning `null` on failure. Never throw.

- [ ] **Step 4: Implement `fingerprint.ts`**

Build an identity string from `title.toLowerCase()`, `company.toLowerCase()`, `location.toLowerCase()`, and the ISO string of `postedAt` (empty string when null). Hash it with `crypto.subtle.digest("SHA-256", ...)` and return the hex string. The function is `async` and returns `Promise<string>`, because Workers expose `crypto.subtle` as a global async API.

Note on Review Focus item 2: the fingerprint deliberately excludes `externalId` and `postingUrl`, because the same vacancy legitimately appears on several sources under different URLs. Two distinct openings at the same company with the same title and location *will* over-merge into one job. That is a known v0.1 limitation; the manual merge path that resolves it is deferred to v0.2.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter api test normalize`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/discovery/normalize.ts apps/api/src/features/discovery/fingerprint.ts apps/api/tests/features/discovery/normalize.test.ts
git commit -m "feat(discovery): normalization and dedup fingerprint"
```

---

## Task 7: Ingest orchestration

Carries Review Focus item 5.

**Files:**
- Create: `apps/api/src/features/discovery/discovery.repo.ts`
- Create: `apps/api/src/features/discovery/ingest.ts`
- Create: `apps/api/src/features/discovery/discovery.routes.ts`
- Create: `apps/api/src/features/discovery/index.ts`
- Modify: `apps/api/src/index.ts` — mount the discovery router
- Test: `apps/api/tests/features/discovery/ingest.test.ts`

**Interfaces:**
- Consumes: `remotiveAdapter`, `normalize`, `fingerprint` (Tasks 5–6), `createDb` (Task 3), tables (Task 2)
- Produces: `ingestJobs(db: Db, adapter: JobSourceAdapter): Promise<IngestResult>` where `IngestResult` is `{ fetched: number; inserted: number; merged: number; failed: number }`. HTTP `POST /api/discovery/run` and `GET /api/jobs`.

- [ ] **Step 1: Write the failing test for the merge path**

Create `apps/api/tests/features/discovery/ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ingestJobs } from "../../../src/features/discovery/ingest";
import { createDb } from "../../../src/db/client";
import type { JobSourceAdapter } from "../../../src/features/discovery/source";

const raw = {
  externalId: "1",
  title: "Frontend Engineer",
  company: "Acme",
  location: "Remote",
  isRemote: true,
  description: "React and TypeScript",
  postingUrl: "https://x",
  raw: {},
};

function adapterReturning(rows: unknown[]): JobSourceAdapter {
  return {
    key: "test",
    name: "Test",
    fetchJobs: async () => rows as never,
  };
}
```

Then three tests, all `describe.skipIf(!process.env.DATABASE_URL)`:

1. First ingest of `raw` reports `inserted: 1`.
2. Second ingest of the same `raw` reports `inserted: 0, merged: 1`.
3. `ingestJobs` called twice **concurrently** via `Promise.all` returns a combined `inserted` of exactly 1 — one insert wins, the loser is caught and counted as `merged`, not thrown.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test ingest`
Expected: FAIL — cannot resolve the ingest module.

- [ ] **Step 3: Implement `discovery.repo.ts`**

```ts
export async function upsertSource(db: Db, key: string, name: string, integrationType: string): Promise<string>
export async function findJobByFingerprint(db: Db, fp: string): Promise<{ id: string } | null>
export async function insertJob(db: Db, job: NormalizedJob, fp: string, sourceId: string, externalId: string, raw: unknown): Promise<{ id: string; created: boolean }>
export async function listJobs(db: Db, limit: number): Promise<JobSelect[]>
```

`upsertSource` uses `onConflictDoUpdate` on `jobSource.key` and returns the id. `insertJob` inserts the job and its `sourceJob` row inside a transaction, catching the unique-violation on `job.fingerprint` to detect the concurrent-duplicate case.

- [ ] **Step 4: Implement `ingest.ts`**

```ts
export async function ingestJobs(db: Db, adapter: JobSourceAdapter): Promise<IngestResult>
```

Upsert the source, fetch, then `for` each raw row: run `normalize`, compute `await fingerprint`, look up an existing job by fingerprint, and either increment `sourceJobCount` + insert a `sourceJob` row (`merged++`) or insert a new job + `sourceJob` (`inserted++`). Wrap each row in its own try/catch so one bad row increments `failed` and the batch continues. Update `jobSource.lastSyncedAt` at the end.

- [ ] **Step 5: Run it to verify it passes**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api test ingest`
Expected: PASS, 3 tests. Without `DATABASE_URL` they skip and the file reports as skipped.

- [ ] **Step 6: Implement the routes and mount them**

`discovery.routes.ts` exports `POST /run` (calls `ingestJobs` with `remotiveAdapter`, returns the `IngestResult` as JSON) and `GET /` (calls `listJobs`). Mount at `/api/discovery` and `/api/jobs` in `src/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/features/discovery apps/api/src/index.ts apps/api/tests/features/discovery/ingest.test.ts
git commit -m "feat(discovery): ingest orchestration with dedup"
```

---

## Task 8: Exclusion and level matching (pure)

Carries Review Focus item 3.

**Files:**
- Create: `apps/api/src/features/matching/exclusions.ts`
- Create: `apps/api/src/features/matching/levels.ts`
- Test: `apps/api/tests/features/matching/exclusions.test.ts`

**Interfaces:**
- Consumes: `NormalizedJob` shape (Task 6), `JobProfileSelect` (Task 2)
- Produces:
  - `checkExclusions(job: NormalizedJob, patterns: string[]): ExclusionHit[]` where `ExclusionHit` is `{ pattern: string; field: "title" | "company" | "description"; matchedText: string }`
  - `detectLevel(title: string): string | null` returning one of `"Trainee" | "Junior" | "Middle" | "Strong Junior-Middle" | "Senior" | "Staff" | "Lead" | "Principal"`, or `null` when absent

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/features/matching/exclusions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkExclusions } from "../../../src/features/matching/exclusions";
import { detectLevel } from "../../../src/features/matching/levels";

const job = {
  title: "Frontend Engineer",
  company: "Acme",
  companyUrl: null,
  location: "Remote",
  isRemote: true,
  description: "We build crypto accounting tools in React.",
  postedAt: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postingUrl: "https://x",
};

describe("checkExclusions", () => {
  it("reports the field the term matched in", () => {
    const hits = checkExclusions(job, ["crypto"]);
    expect(hits).toEqual([
      { pattern: "crypto", field: "description", matchedText: "crypto" },
    ]);
  });

  it("matches a term in the title", () => {
    const hits = checkExclusions({ ...job, title: "Casino Frontend Engineer" }, ["casino"]);
    expect(hits[0].field).toBe("title");
  });

  it("matches a term in the company name", () => {
    const hits = checkExclusions({ ...job, company: "Blockchain Labs" }, ["blockchain"]);
    expect(hits[0].field).toBe("company");
  });

  it("returns no hits when the profile has no exclusions", () => {
    expect(checkExclusions(job, [])).toEqual([]);
  });

  it("is case-insensitive", () => {
    const hits = checkExclusions({ ...job, description: "NFT marketplace" }, ["nfts"]);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("detectLevel", () => {
  it("finds Junior in a title", () => {
    expect(detectLevel("Junior Frontend Engineer")).toBe("Junior");
  });

  it("finds Middle via the mid abbreviation", () => {
    expect(detectLevel("Mid-level React Developer")).toBe("Middle");
  });

  it("prefers the more specific Strong Junior-Middle", () => {
    expect(detectLevel("Strong Junior-Middle Developer")).toBe("Strong Junior-Middle");
  });

  it("returns null when the title has no level", () => {
    expect(detectLevel("Software Engineer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test exclusions`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Implement `exclusions.ts`**

Pure, case-insensitive substring match over `title`, `company`, and `description` only. Return every hit with its field and the actual matched substring. Do not match against `postingUrl`. Skip empty patterns so a stray `""` in the profile cannot match everything.

Add a comment recording the known limitation: substring matching flags the word "crypto" in "crypto accounting tools", which is arguably a false positive for someone excluding crypto *jobs*. The v0.2 improvement is negation-aware matching. This is a deliberate v0.1 simplification, not an oversight.

- [ ] **Step 4: Implement `levels.ts`**

Check `Strong Junior-Middle` before `Junior` and `Middle` so the most specific level wins. Treat `mid`, `middle`, `intermediate` as `Middle`. Return `null` when nothing matches — this is the case open question #4 in the spec refers to, where job titles frequently omit the level.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter api test exclusions`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/matching/exclusions.ts apps/api/src/features/matching/levels.ts apps/api/tests/features/matching/exclusions.test.ts
git commit -m "feat(matching): exclusion and level detection"
```

---

## Task 9: Scoring (pure)

Carries Review Focus item 4.

**Files:**
- Create: `apps/api/src/features/matching/score.ts`
- Test: `apps/api/tests/features/matching/score.test.ts`

**Interfaces:**
- Consumes: `NormalizedJob`, `CandidateSelect`, `JobProfileSelect`, `checkExclusions` (Task 8)
- Produces: `scoreJob(job: NormalizedJob, candidate: CandidateSelect, profile: JobProfileSelect): MatchResult` where `MatchResult` is `{ score: number; matchedSignals: string[]; missingSignals: string[]; excluded: boolean; exclusionReasons: ExclusionHit[]; explanation: string }`. `score` is an integer `0`–`100`.

**Scoring rules fixed by this plan** (equal weights, per spec open question #3):

A job excluded by `checkExclusions` scores `0`, sets `excluded: true`, and still reports `matchedSignals` so the UI can show why it was rejected. Otherwise score is the sum of four components, each worth 25 points:

1. **Role fit** — 25 if any `desiredRoles` entry is a case-insensitive substring of the title.
2. **Tech overlap** — 25 × (matched `preferredTechnologies` ÷ total `preferredTechnologies`), rounded. **0 when the technology list is empty.**
3. **Location / remote fit** — 25 if `isRemote` is true and the profile accepts remote.
4. **Level fit** — 25 if `detectLevel(title)` is in `positionLevels`.

**Salary is deliberately excluded from the v0.1 score.** The profile records `salaryMin`/`salaryMax`, and the UI displays the job's salary, but no salary component is scored or filtered in v0.1. Open question #5 in the spec ("strict filter, warning, or informational only") is unresolved, and cross-border remote offers vary by employer policy in a way that would make a v0.1 rule wrong as often as right. Resolve #5 before adding a salary component; do not guess it here.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/features/matching/score.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreJob } from "../../../src/features/matching/score";

const job = {
  title: "Junior Frontend Engineer",
  company: "Acme",
  companyUrl: null,
  location: "Remote",
  isRemote: true,
  description: "React and TypeScript",
  postedAt: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  postingUrl: "https://x",
};

const candidate = {
  id: "c1",
  tenantId: "default",
  name: "Alex",
  email: "a@b.c",
  headline: null,
  experience: [],
  skills: [],
  technologies: ["React", "TypeScript"],
  cvUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const profile = {
  id: "p1",
  tenantId: "default",
  candidateId: "c1",
  desiredRoles: ["Frontend Engineer"],
  locations: [],
  workModes: ["Remote"],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "USD",
  preferredTechnologies: ["React", "TypeScript"],
  exclusionPatterns: [],
  positionLevels: ["Junior"],
  updatedAt: new Date(),
};

describe("scoreJob", () => {
  it("gives a perfect score when everything matches", () => {
    const r = scoreJob(job, candidate as never, profile as never);
    expect(r.score).toBe(100);
    expect(r.excluded).toBe(false);
  });

  it("scores zero when the technology list is empty, and never NaN", () => {
    const r = scoreJob(job, candidate as never, { ...profile, preferredTechnologies: [] } as never);
    expect(r.score).toBe(0);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  it("scores zero and flags the job when an exclusion matches", () => {
    const r = scoreJob(job, candidate as never, { ...profile, exclusionPatterns: ["casino"] } as never);
    expect(r.score).toBe(0);
    expect(r.excluded).toBe(true);
  });

  it("still reports matched signals on an excluded job", () => {
    const r = scoreJob(job, candidate as never, { ...profile, exclusionPatterns: ["casino"] } as never);
    expect(r.matchedSignals.length).toBeGreaterThan(0);
  });

  it("loses the role component when the title does not match a desired role", () => {
    const r = scoreJob({ ...job, title: "Data Analyst" }, candidate as never, profile as never);
    expect(r.score).toBe(75);
  });

  it("never exceeds 100", () => {
    const r = scoreJob(job, candidate as never, profile as never);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test score`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement `score.ts`**

Pure function, no I/O. Guard the tech-overlap division against an empty denominator. Build `explanation` as a short human sentence listing the components earned, e.g. `"Matched: Frontend Engineer, React, TypeScript, Remote, Junior"`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test score`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/matching/score.ts apps/api/tests/features/matching/score.test.ts
git commit -m "feat(matching): rule-based job scoring"
```

---

## Task 10: Matching run and read API

**Files:**
- Create: `apps/api/src/features/matching/matching.repo.ts`
- Create: `apps/api/src/features/matching/matching.routes.ts`
- Create: `apps/api/src/features/matching/index.ts`
- Modify: `apps/api/src/index.ts` — mount the matching router
- Test: `apps/api/tests/features/matching/matching.test.ts`

**Interfaces:**
- Consumes: `scoreJob`, `listJobs` (Tasks 7, 9), tables (Task 2)
- Produces: `runMatching(db: Db): Promise<{ scored: number; excluded: number }>`; HTTP `POST /api/matching/run` and `GET /api/matches`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/features/matching/matching.test.ts`, `describe.skipIf(!process.env.DATABASE_URL)`:

1. Seed one job via `ingestJobs` and one profile via `upsertProfile`, run `runMatching`, then read `GET /api/matches` and assert the response contains that job with a numeric `score`.
2. Run `runMatching` twice and assert the match count does not double — the unique index on `(candidateId, jobId)` plus `onConflictDoUpdate` must upsert.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test matching`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Implement `matching.repo.ts` and `runMatching`**

```ts
export async function upsertMatch(db: Db, m: MatchResult & { candidateId: string; jobId: string }): Promise<void>
export async function listMatches(db: Db, limit: number): Promise<(MatchSelect & { job: JobSelect })[]>
export async function runMatching(db: Db): Promise<{ scored: number; excluded: number }>
```

`runMatching` loads the single-user profile and all jobs, scores each with `scoreJob`, upserts, and returns the counts. Wrap each job in a try/catch so one bad row does not abort the run.

**Batching is required, not optional.** Workers Free kills an invocation that exceeds 10ms CPU, and scoring an unbounded job list in one request will exceed it. `runMatching` must therefore accept a `limit` (default 50) and score at most that many unscored jobs per invocation, selecting the lowest `computedAt` rows first. The endpoint is then called repeatedly until it reports zero remaining, which is what a caller or the v0.2 queue will drive. Record this batching limit as a named constant with a comment citing the 10ms ceiling, so the number can be tuned against measurement rather than guessed at again.

`listMatches` uses drizzle's `with` relation or an inner join to attach the job, ordered by `score` descending.

- [ ] **Step 4: Implement the routes and mount them**

`POST /api/matching/run` returns the counts; `GET /api/matches?limit=` returns the ranked list. Mount in `src/index.ts`.

- [ ] **Step 5: Run it to verify it passes**

Run: `DATABASE_URL=<your-neon-url> pnpm --filter api test matching`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/matching apps/api/src/index.ts apps/api/tests/features/matching/matching.test.ts
git commit -m "feat(matching): matching run and ranked read api"
```

---

## Task 11: Profile form and ranked job list UI

**Files:**
- Create: `apps/web/app/profile/page.tsx`
- Create: `apps/web/app/jobs/page.tsx`
- Create: `apps/web/app/layout.tsx` — add nav links, preserve existing content
- Create: `apps/web/lib/api.ts` — typed fetch helpers
- Create: `apps/api/tests/features/matching/match-payload.test.ts`

**Interfaces:**
- Consumes: the four endpoints from Tasks 4, 7, 10
- Produces: `getProfile()`, `putProfile(payload)`, `runDiscovery()`, `runMatching()`, `listMatches()` in `apps/web/lib/api.ts`

- [ ] **Step 1: Write the failing test for the API payload contract**

Create `apps/api/tests/features/matching/match-payload.test.ts`, asserting that a `MatchResult` from `scoreJob` serialized to JSON has keys `score`, `matchedSignals`, `missingSignals`, `excluded`, `exclusionReasons`, `explanation`, and that `score` is a number not a string. This pins the wire format the UI will consume.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test match-payload`
Expected: FAIL until `MatchResult` is confirmed to serialize as expected.

- [ ] **Step 3: Fix `score.ts` or the test so the contract holds**

If any field is missing or `score` serializes as a string, adjust `score.ts`'s return so the contract in step 1 holds. Do not change the test to accommodate a wrong shape.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test match-payload`
Expected: PASS.

- [ ] **Step 5: Write `apps/web/lib/api.ts`**

Export typed async helpers for the five endpoints, each calling `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787"}` and throwing on a non-2xx response.

- [ ] **Step 6: Build the profile page**

`apps/web/app/profile/page.tsx` is a client component with a form for candidate name, email, technologies (comma-separated), desired roles, preferred technologies, position levels, and exclusion patterns. It loads the current profile on mount and saves via `putProfile`. It must show the `400` error body when the API rejects a payload.

- [ ] **Step 7: Build the jobs page**

`apps/web/app/jobs/page.tsx` renders a table of matches sorted by score, showing title, company, score, level, remote flag, matched signals, and — when `excluded` is true — the exclusion reasons. Two buttons: "Ingest jobs" calling `runDiscovery`, and "Score jobs" calling `runMatching`.

- [ ] **Step 8: Add nav links to the layout**

Add `Profile` and `Jobs` links to `apps/web/app/layout.tsx` without altering the existing font or global CSS setup.

- [ ] **Step 9: Verify types and lint pass**

Run: `pnpm turbo run check-types lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web apps/api/tests/features/matching/match-payload.test.ts
git commit -m "feat(web): profile form and ranked job list"
```

---

## Task 12: Replace the starter README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: setup instructions that actually match this repo

- [ ] **Step 1: Rewrite `README.md`**

Replace the unmodified Turborepo starter text with: prerequisites (Node 24, pnpm 12, a free Cloudflare account, a free Neon project — **neither requires a credit card**), the exact commands to install, create `.dev.vars` from `.dev.vars.example`, run migrations, and start both apps, plus a short architecture summary, the $0/month cost note from spec §12, and a pointer to the spec.

Do not mention any paid plan, tier, or upgrade in this README. The project runs at $0 and the README must not imply otherwise.

- [ ] **Step 2: Verify the documented commands actually work**

Run each command in the README from a clean shell and confirm it runs. Fix the README if any command is wrong — a README that lies is worse than no README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: replace starter readme with real setup instructions"
```

---

## Definition of Done for v0.1

- `pnpm turbo run test` passes with no database configured (route and integration tests skip cleanly).
- `pnpm turbo run test` passes with `DATABASE_URL` set and the Neon integration tests run.
- `pnpm turbo run check-types` and `pnpm turbo run lint` pass.
- `POST /api/discovery/run` twice in a row reports `inserted: N` then `inserted: 0, merged: N`.
- `POST /api/matching/run` then `GET /api/matches` returns jobs ranked by score, with excluded jobs showing reasons.
- The profile form round-trips the values recorded in `docs/superpowers/profiles/default-profile.json`.
- No AI provider call, no queue binding, and no cover-letter code exists anywhere in the tree.
- No setup step, README line, or config file requires a paid plan. The project runs at $0/month.