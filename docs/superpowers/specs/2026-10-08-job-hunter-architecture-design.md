# Job Hunter Architecture Design

*Version: 1.1 | Date: 2026-10-08 | Status: Approved*

> **v1.1 amendment**: corrected the stack to match the actual repository. Next.js 16 replaces TanStack Start; Cloudflare Queues replaces the proposed Redis queue; Vitest added. See §11 for the full list of changes and the rationale.

## 1. Proposed Architecture

**Job Hunter** is a single-tier (monolithic) TypeScript platform with a discovery-driven core. It runs as three deployable units sharing one PostgreSQL database:

- **`apps/api`** — Hono HTTP API running on **Cloudflare Workers** (`wrangler`), connecting to Neon over the `@neondatabase/serverless` HTTP driver
- **`apps/web`** — **Next.js 16** (App Router, React 19) frontend consuming the API
- **`apps/worker`** — Cloudflare Queue consumer for async AI workloads (analysis, matching, tailoring)
- **`postgres (Neon)`** — primary relational store, accessed via the serverless HTTP driver
- **`packages/`** — shared config packages + UI library

The architecture is deliberately **monolithic**, not microservices, event bus, or CQRS. Each functional area is a feature module within the same codebase, separated by folder and bounded by interfaces where providers are swappable. This keeps the system understandable and keeps the 2–3 week MVP feasible.

**Key design decision**: heavy AI workloads (matching, analysis, tailoring) run **asynchronously** on a Cloudflare Queue; user-facing operations (profile CRUD, applications, job search) are **synchronous**. This gives the perception of speed while keeping AI cost/latency controlled.

**Cost note**: the entire stack runs on free tiers at **$0/month**. Cloudflare Queues on the Workers **Free** plan includes 10,000 operations/day with 24-hour message retention. See §12 for the verified free-tier budget.

---

## 2. Domain Map — Modules & Entities

### 2.1 Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| **Profile** | Candidate profile + Job Search Profile |
| **Job Discovery** | Fetch, normalize, deduplicate, store job postings |
| **Job Analysis** | Structured extraction from raw job descriptions |
| **Matching** | Score & rank candidates against jobs |
| **Tailoring** | Adapt CV per job (plain English suggestions)
| **Applications** | Application lifecycle + change history |
| **Analytics** | Pipeline metrics + source effectiveness |

### 2.2 Core Entities (canonical model, DB-independent of providers)

- **Job** — canonical normalized posting (UUID, title, company, location, description, postedDate, status, sourceId, tags[], salaryRange, postingURL)
- **JobSource** — external source metadata (id, name, integrationType: `api|scraper|upload`, accessLevel, lastSyncedAt)
- **SourceJob** — *source-specific* raw data copy linked by `sourceId + externalId` (raw JSON payload; never mutates canonical Job)
- **Candidate** — experience[], skills[], technologies[], cvUrl, active
- **JobProfile** — desiredRoles[], locations[], workMode[], salary[], preferredTech[], exclusionPatterns[]
- **JobAnalysis** — requirements[], technologies[], minExperience, salaryEstimate, redFlags[]
- **Match** — candidateId, jobId, score, matchedRequirements[], missingRequirements[], explanation
- **Application** — candidateId, jobId, status enum (saved|applied|screening|interview|offer|rejected|withdrawn), history[]
- **AnalyzedDocument** — (future) analytics aggregations

### 2.3 Entity Relationships (ER view)

```
Candidate ──────┐
                ├─► Match ◄──────── Job
JobProfile ─────┘        └─► JobAnalysis
JobSource ──► SourceJob ──► Job   (1:N)
Application ──► Job      (N:M via Application)
Match ──► (feeds) Analytics
Application.history[] ──► AuditLog
```

- `JobSource` 1:N `SourceJob` — one source produces many raw postings
- `SourceJob` → `Job` — many source copies collapse into one canonical Job (dedup)
- `Candidate` + `JobProfile` → `Match` → `Application` — the discovery→matching→tracking spine
- `JobAnalysis` and `Match` are **derived** data: recomputed on change, not primary inputs

### 2.4 Ownership Model

| Data | Owner | Rationale |
|------|-------|-----------|
| **Candidate** | User | Personal identity and CV |
| **JobProfile** | User | Personal search preferences |
| **Job** | Platform (global) | Canonical reference shared across users |
| **SourceJob** | Platform (source-logged) | Raw external copy retained for audit/re-sync |
| **JobAnalysis / Match** | Derived | Computed per candidate-job pair; cheap to recompute |
| **Application / history** | User | User's own application decisions |
| **Analytics** | Derived | Aggregation; recomputed from events |

---

## 3. Core Workflows

### 3.1 Discovery & Normalization

| Aspect | Definition |
|--------|------------|
| **Input** | External postings from JobSource adapters (API response, scraped HTML, uploaded CSV) |
| **Output** | Canonical `Job` rows + retained `SourceJob` raw copies |
| **Persistent State** | `Job` (deduped, one per external id + fingerprint), `SourceJob`, `JobSource` metadata |
| **External Dependency** | Job source APIs (LinkedIn, Indeed, etc.), scraper runtime |
| **Async/Sync** | **Async** (queued batch: fetch → normalize → dedupe → store) |

*Dedup fingerprint*: `hash(title + company + location + postedDate)` before DB write; duplicates merge into the canonical Job and are marked as additional `SourceJob` references.

### 3.2 Analysis

| Aspect | Definition |
|--------|------------|
| **Input** | Unanalyzed `Job` with full description text |
| **Output** | Structured `JobAnalysis` (requirements, technologies, minExperience, salaryEstimate, redFlags) |
| **Persistent State** | `JobAnalysis` row; cached to avoid reprocessing unchanged descriptions (versioned on Job `updatedAt`) |
| **External Dependency** | AI provider (Llama, OpenAI, Anthropic — via Adapter) |
| **Async/Sync** | **Async** (triggered on job ingestion; user requests can be sync with a queued fallback) |

### 3.3 Matching

| Aspect | Definition |
|--------|------------|
| **Input** | `JobAnalysis` + `Candidate` + `JobProfile` |
| **Output** | Ranked `Match` list per candidate with score, matchedRequirements, missingRequirements, explanation |
| **Persistent State** | `Match` row (per candidate-job pair); invalidated when Candidate, JobProfile, or JobAnalysis changes |
| **External Dependency** | Matching engine (rule-based scoring first; ML model if added later — via Adapter) |
| **Async/Sync** | **Async** (queued when Candidate/JobProfile/JobAnalysis changes; user query reads latest cached score) |

### 3.4 Tailoring

| Aspect | Definition |
|--------|------------|
| **Input** | `Candidate` CV + `Match` (gap analysis) |
| **Output** | Tailored CV (sections updated for target job)
| **Persistent State** | Generated document versions; reference URL stored on request |
| **External Dependency** | AI provider (via Adapter); document generation (future) |
| **Async/Sync** | **Async** — heavy text work; synchronous preview of a "suggested edit" only |

### 3.5 Application Tracking

| Aspect | Definition |
|--------|------------|
| **Input** | `Application` status change (submit, advance stage, reject, withdraw) |
| **Output** | Updated application record + `AuditLog` change entry |
| **Persistent State** | `Application.status`, `Application.history[]`, `AuditLog` immutable append-only |
| **External Dependency** | None (internal state only; notification delivery if configured) |
| **Async/Sync** | **Sync** — critical user action; notifications via queue |

### 3.6 Analytics

| Aspect | Definition |
|--------|------------|
| **Input** | Events from Application lifecycle + Match quality data |
| **Output** | Dashboards: applications per source, conversion rates, rejection reasons, pipeline stage funnel, profile effectiveness |
| **Persistent State** | Snapshot aggregations (recomputed on change or on-demand) |
| **External Dependency** | None |
| **Async/Sync** | **Sync on-demand** (pre-compute recent-window caches) |

---

## 4. Interfaces / Ports (Swappable Providers)

Every external dependency is behind a **typed interface** so providers can be swapped without touching business logic. ArkType validators run at the boundary to normalize incoming data.

| Interface | Contracts | Swappable Implementations |
|-----------|-----------|---------------------------|
| `JobSourceAdapter` | `fetchJobs()` → normalized rows + raw payload | LinkedIn API, Indeed API, Company Career Pages, Custom Scraper, manual CSV upload |
| `AnalyticAI` | `analyzeJob(description)` → `JobAnalysis` | Llama (Ollama), OpenAI, Anthropic, custom fine-tune |
| `TailorAI` | `tailorCV(cv, jobAnalysis)` → tailored content | Same providers as above |
| `MatchingEngine` | `score(candidate, job)` → `Match` | Rule-based scoring (MVP), embedding similarity, third-party service |
| `NotificationSender` | `sendEmail`, `sendPush` | SMTP, SES, Twilio, webhooks |
| `DocumentStore` | `put`, `get`, `delete` files | Cloudflare R2 (prod), local FS (dev) |
| `JobQueue` | `enqueue(job)`, consumer handler | Cloudflare Queues (prod), in-process (dev/tests) |

**Database independence**: no AI-provider field lives inside core entities. Provider metadata (last used, token budget) is scoped to a `ProviderConfig` entity, not a `Job` or `Match`. This satisfies the requirement that the schema is not tied to a specific provider.

---

## 5. Architectural Decisions

1. **Monolith, single DB.** One Hono API on Cloudflare Workers, one Next.js 16 frontend, one Queue consumer, one PostgreSQL (Neon). No microservices, no event bus, no CQRS. Modules are folders; boundaries are interfaces.
2. **Async-first for AI, sync for user actions.** Cloudflare Queues drive matching/analysis/tailoring; immediate responses for profile, applications, and searches. The queue is reached only through the `JobQueue` port (see §4).
3. **Source adapters produce raw + normalized.** Canonical `Job` never carries source-specific cruft; raw payloads live in `SourceJob`. This keeps the canonical model stable regardless of how many sources are added.
4. **Dedup before storage.** Fingerprinting happens in the adapter/normalizer, so the canonical `Job` table stays small and indexed.
5. **Derived data is cheap, not permanent-critical.** `JobAnalysis`, `Match`, and analytics are recomputed on trigger — no sync constraints needed on their persistence.
6. **ArkType at every boundary.** API input, source payloads, and AI outputs validated at edges; pure function core.
7. **Single-user-first with `tenant_id` scaffolding.** All core tables carry `tenantId` now (not enforced) so the multi-tenant path is a schema change, not a rewrite.
8. **ProviderConfig for provider metadata only.** Tracks which provider last processed a job/candidate; business entities carry no vendor lock-in.
9. **Simple JWT auth for MVP.** No RBAC, no OAuth flows. Extends to per-user JWT with tenantId claims.

---

## 6. Open Questions

Questions 4, 5 and 6 from this list were **resolved**: CV parsing is manual entry (v0.1), cover letter generation is deferred to v0.2, and tailoring output is in-app text only.

The remaining open questions were re-scoped against the real repository and are now tracked in **§11 Still open**. Summary:

1. **v0.1 priority sources** — which 1–2 sources, and do you have API keys for them? Blocks the first adapter task.
2. **v0.2 AI provider** — OpenAI, Anthropic, or local. Not needed for v0.1.
3. **Matching weighting** — equal weights in v0.1 unless specified otherwise.
4. **Level detection** — how to handle job titles with no level in them.
5. **Salary filtering for cross-border remote** — strict filter, warning, or informational.
6. **Drizzle 1.0 RC** — verify installed API before writing repositories.

---

## 7. MVP Scope (2–3 weeks)

### In scope

| Area | MVP deliverable |
|------|-----------------|
| **Discovery** | Ingest from 1–2 priority sources via adapters; normalization; fingerprint dedup; `SourceJob` raw storage |
| **Profiles** | Create/edit `Candidate` + `JobProfile` (roles, locations, mode, salary, tech stack, exclusions) |
| **Analysis** | One AI provider; structured requirements + technology extraction; red-flag list |
| **Matching** | Rule-based scoring; ranked matches per candidate with matched/missing requirements and plain-English explanation |
| **Tailoring** | Suggested CV text edits per job (plain English suggestions, in-app preview/edit) — *no cover letter generation* |
| **Applications** | CRUD + 6-stage lifecycle; immutable `history[]` audit log |
| **Analytics** | Basic dashboard: applications/source, stage funnel, rejection rate |
| **Provider swaps** | All interfaces implemented; swap via `ProviderConfig` |

### Release slicing

The MVP is delivered in three independently shippable releases, each producing working software:

| Release | Contents | Needs AI? | Needs queue? |
|---|---|---|---|
| **v0.1** | Profiles (Candidate + JobProfile), Discovery (adapters, normalization, dedup), rule-based Matching | No | No |
| **v0.2** | Analysis (AI provider), Tailoring, Applications tracking | Yes | Yes |
| **v0.3** | Analytics, Notifications | No | No |

**v0.1 deliberately requires no AI provider and no queue.** Matching in v0.1 is keyword/overlap scoring over the normalized job text, which is instantaneous at v0.1 data volumes. This removes the AI-provider decision, the AI cost line, and the Workers Paid plan requirement from the critical path. The queue decision (Cloudflare Queues) is recorded here and implemented in v0.2, when a workload actually needs it.

### Intentionally out of scope (for MVP)

- Multi-tenancy (separate DBs per user) — single-user with `tenantId` column present only
- OAuth / SSO, role-based access control
- PDF/docx/Word document generation (in-app text only)
- Cover letter generation (deferred to v0.2)
- Automated CV/resume parsing via NLP/LLM (skills entered manually for v0.1)
- ML-based matching — rule-based scoring first
- Source webhooks / real-time sync — manual or cron-triggered
- Automated outbound outreach / bot applications
- Team features / shared profiles
- Mobile app / PWA offline mode
- Deep integration into external ATS systems (greenhouse, lever)

---

## 8. Architectural Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Job sources change APIs or block scrapers | High | Adapter interface isolates each source; graceful degradation with `lastSyncedAt` stale flags |
| AI output drift / quality variance | Medium | Versioned analyses; `JobDescriptionVersion` comparison; re-run only on change |
| Over-building abstractions early | Medium | Enforce: no interface unless a second implementation already exists (start with one impl + a documented interface) |
| Dedup collisions (same title, different job) | Medium | Fingerprint uses multiple fields; manual merge UI for flagged duplicates |
| Candidate-job matching latency as catalog grows | Low | Indexed search on `Job`; incremental match updates instead of full recompute |
| Cost creep from AI calls | Medium | `ProviderConfig` budgets, per-source rate limiting, cache analyses by description hash |
| Cloudflare Queues locks async to one vendor | Medium | Queue reached only through the `JobQueue` port; in-process implementation used in dev/tests proves the seam |
| Workers **Free** allows only **10ms CPU per invocation** | High | Scoring hundreds of jobs in one synchronous request will exceed this. Batching work into the queue (v0.2) is the mitigation; v0.1 keeps job counts low enough to stay inside the limit. If it is ever exceeded, the fix is batching, not a paid plan. |
| Free AI tiers may retain prompts for model training | High | Candidate CV content is personal data. Prefer a local model (Ollama) or a provider whose free tier does not train on prompts. This is an explicit product decision, not an implementation detail. |
| Drizzle pinned to `1.0.0-rc.4` (release candidate) | Medium | Treat 1.0 RC APIs as the source of truth, not 0.x documentation; verify against the installed package before relying on any API |

---

## 9. Testing Strategy

Vitest is the test runner for all packages and apps. A `test` task is added to `turbo.json` so `turbo run test` runs the whole suite.

- **Pure logic is unit-tested**: normalization, fingerprinting/dedup, matching scoring, and exclusion matching are all pure functions and are tested without a database or network.
- **Ports are tested with fakes**: `JobSourceAdapter`, `AnalyticAI`, and `JobQueue` each have an in-memory fake so workflow tests need no Cloudflare or Neon.
- **Integration tests hit Neon only** for the repository layer, and are the only tests that require a `DATABASE_URL`.
- No browser or end-to-end tests in the MVP.

---

## 10. Environment & Secrets

There is no `.env` file in the repository and `.env*` is already listed as a build input in `turbo.json`. Secrets are **not** read via `dotenv` (that package is inert on Cloudflare Workers and is removed from `apps/api` dependencies):

- Local development: a git-ignored `.dev.vars` file, read by `wrangler dev`.
- Deployed: `wrangler secret put <NAME>`.

Required variables: `DATABASE_URL` (Neon), and in v0.2 `AI_API_KEY`, `QUEUE_ID`, `R2_BUCKET`.

---

## 12. Zero-Cost Constraint

**The project must run entirely on free tiers. Target monthly cost: $0.** No paid plan may be required to develop, test, or run this project.

Free-tier budget, verified against vendor pricing pages on 2026-10-08:

| Component | Free tier allowance | Verified source |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day, **10ms CPU per invocation** | Workers pricing |
| Cloudflare Queues | 10,000 operations/day included, 24h retention | Queues pricing |
| Workers KV | 100,000 reads/day, 1,000 writes/day, 1 GB | Workers pricing |
| Neon PostgreSQL | $0/month, **no credit card required**, 1 GB storage/project, 100 CU-hours/project, 5 GB egress/project | Neon pricing |
| R2 | 10 GB-month storage | Workers pricing |
| AI provider (v0.2) | Groq: free, no card, ~14,400 req/day. Cerebras: free, 30 RPM. Gemini: free, no card, lower quotas | provider rate-limit docs |

### Constraints this budget imposes

1. **No paid plan may appear in setup documentation.** If a task or a README instructs the user to enable a paid tier, that is a defect.
2. **The 10ms CPU ceiling is a design constraint, not an incident.** Workers Free kills an invocation that exceeds it. Work that scales with job count must be batched through the queue rather than done in one request.
3. **Neon's 1 GB per-project storage cap** is the practical ceiling on how many raw source payloads can be retained. `source_job.raw` is the growth driver; if it approaches the cap, prune `raw` before pruning canonical `Job` rows, because the canonical row is the deduplicated result and is not reproducible.
4. **No credit card on file.** Prefer free tiers that never require one, so an overage cannot silently become a charge. Verify this for any new provider before adopting it.
5. **Free-tier quotas are not contracts.** They change without notice. All provider limits are configuration values, never hardcoded constants.

### AI provider and personal data

Candidate CV content is personal data. Several free AI tiers permit the provider to use prompts and responses for model improvement, and some cannot be opted out of on the free tier. The v0.2 provider choice must state, explicitly, whether CV content is sent to a third party at all. A locally hosted model (Ollama) is $0 and fully private on hardware the user already owns. This is recorded as an open product decision in §11, not an implementation detail.

---

## 13. Amendment Log (v1.0 → v1.1 → v1.2)

The v1.0 spec was written before the repository was inspected and described a stack that does not exist. v1.1 corrects it.

| # | v1.0 claimed | v1.1 reality | Reason |
|---|---|---|---|
| 1 | Frontend is TanStack Start | Frontend is **Next.js 16** | `apps/web` already runs Next.js 16 App Router. Migrating would be pure cost for no v0.1 benefit. |
| 2 | Async runs on a Redis queue | Async runs on **Cloudflare Queues** | The API is hosted on Cloudflare Workers, which cannot hold a Redis socket or run a long-lived queue consumer. BullMQ/pg-boss are both impossible there. |
| 3 | `DocumentStore` via S3 | **Cloudflare R2** | Matches the Workers runtime; no external vendor needed. |
| 4 | No test strategy | **Vitest**, with fakes at every port | No test runner existed. TDD requires one before the first feature task. |
| 5 | `dotenv` for config | `.dev.vars` + `wrangler secret` | `dotenv` does not work on Workers. |
| 6 | Single flat 2–3 week MVP | Sliced into **v0.1 / v0.2 / v0.3** | Eight bounded contexts do not fit one plan. Each slice ships working software. |
| 7 | v0.1 includes AI analysis and matching | v0.1 has **no AI and no queue** | Defers the undecided AI-provider question and the Workers Paid plan cost off the critical path. |

### v1.2 amendment

| # | Change | Reason |
|---|---|---|
| 8 | **Corrected a factual error in v1.1.** v1.1 claimed Cloudflare Queues requires the Workers Paid plan at $5/month. This was wrong. Queues on the Workers **Free** plan includes 10,000 operations/day. | Caught by checking the vendor pricing page instead of relying on recall. The whole stack is therefore $0, and §12 records the verified budget. |
| 9 | Added §12 Zero-Cost Constraint as a project-wide requirement | The project must use free tiers only. This is now a binding constraint, not a preference. |
| 10 | Recorded the Workers Free **10ms CPU per invocation** ceiling as a High-impact risk | It is a hard limit that kills the invocation. Large-batch scoring must be queued, not done in one request. |

### Still open (do not guess these)

1. **v0.2 AI provider** — OpenAI, Anthropic, or local model. v0.1 does not need it.
2. **v0.1 priority sources** — Which 1–2 job sources? Determines whether an official API, an RSS/JSON feed, or manual import is the first adapter.
3. **Matching weights** — How are role fit, tech overlap, location, salary, and level weighted against each other? v0.1 ships with equal weights unless told otherwise.
4. **Level detection** — Job titles frequently omit the level ("Software Engineer" with no level). Detection rule needs defining: infer from required years of experience, or leave unmatched when absent.
5. **Salary for remote roles** — Cross-border remote offers vary by employer policy and country. Define whether the filter is strict, a warning, or informational only.
6. **Drizzle 1.0 RC API** — Verify the installed package's API before writing repository code.
