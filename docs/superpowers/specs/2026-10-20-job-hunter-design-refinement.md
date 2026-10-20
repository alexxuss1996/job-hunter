# Job Hunter v0.1 — Design Refinement

*Version: 1.4 | Date: 2026-10-20 | Status: Approved for planning*

**Source design:** Stitch project `9010653019088857937` — “Job Hunter Minimal App”
**Supersedes for UI scope:** `docs/superpowers/specs/2026-10-08-job-hunter-architecture-design.md` §7 MVP scope and any UI assumptions in the 2026-10-08 plan.
**Implementation plan:** `docs/superpowers/plans/2026-10-20-job-hunter-v0.1-design-aligned.md`

## 1. What the design changes

The Stitch design gives v0.1 a concrete product shape:

| Screen | Design intent | v0.1 decision |
|---|---|---|
| Onboarding — Welcome | Choose résumé upload or manual setup | Manual setup only. Upload card is visible but disabled with “PDF parsing coming in v0.2”. |
| Onboarding — Search | Target titles, tech stack, work format, salary floor, match cutoff | Build as step 2 of a 2-step wizard. Include a read-only DOU source card and the “up to 50 postings” fetch note. Rename “notification cutoff” to “minimum match score”. Saving runs discovery and matching, then opens Jobs. |
| Jobs — Ranked list | 6 ranked cards per page, match score, salary, company, location, age, snippet, tags, apply/hide actions | Build as the default screen. Add search, sort, pagination, and a selected-job drawer. The card snippet is the match rationale, not a raw job-description excerpt. |
| Jobs — Right drawer | Full job detail, matching competencies, gaps, external link, save/applied actions | Build the drawer. Omit AI tailoring and cover-letter buttons; they are v0.2. |
| Résumé — Parsed profile | Résumé-derived profile, competencies, experience, matching weights, target preferences | Build as a manually edited profile page. Replace “Parsed from PDF” copy with “Manually maintained”. Show location and currency read-only in the target-preferences card. Disable résumé re-upload and auto-ranking. PDF parsing is v0.2. |
| Settings — Search preferences | Sources, roles, technologies, work format, salary, undisclosed-salary toggle | Build the form. DOU is the only active source. Djinni and “Add source” are disabled placeholders. Show the RSS feed endpoint, not the HTML listing URL. Add exclusions, which the design omitted. |

**v1.4 review note.** A fresh read of all six screens confirmed the scope above. The design’s “notification cutoff”, “archive tab”, “auto-rank”, “parsed from PDF”, and AI action buttons are all UI for behaviour v0.1 does not have. Keep their visual placement where it helps orientation, but disable them or replace the copy so the app never promises a feature it lacks.

## 2. Scope decisions

These are binding for v0.1:

1. **No AI provider call.** Tailoring, cover letters, and semantic resume parsing do not exist in code.
2. **No PDF/DOCX upload or parsing.** The profile is manual. The disabled upload card exists only to explain the v0.2 path.
3. **No queue, no cron, no notifications.** Discovery and matching run from explicit user actions.
4. **DOU.ua is the only job source.** It is read from the public RSS feed. Remotive is no longer the v0.1 adapter.
5. **The design is the visual source of truth.** Colours, type, spacing, radii, and component shapes come from the Stitch design system.
6. **The app is light-mode only.** The design has no dark variant; remove the starter dark-mode media queries.
7. **No Tailwind or component library.** Next.js plus CSS Modules plus design tokens. No new UI dependency.
8. **No `db.transaction`.** The installed `neon-http` driver throws `No transactions support in neon-http driver`. Use `db.batch([...])` for atomic multi-row writes.
9. **Single user.** A fixed candidate UUID and fixed job-profile UUID are used. `tenantId` remains scaffolded.

## 3. Product surfaces

### 3.1 Routes

| Route | Purpose |
|---|---|
| `/` | Redirect to `/jobs` when a profile exists, otherwise `/onboarding`. |
| `/onboarding` | Two-step setup. Step 1 explains setup; step 2 captures search preferences and runs the first ingest. |
| `/jobs` | Default screen. Ranked job cards, search, sort, pagination, detail drawer, actions. |
| `/resume` | Manually edited candidate profile, experience, competencies, and matching-weight explanation. |
| `/settings` | Source status, target roles, technologies, work modes, salary floor, undisclosed-salary toggle, match cutoff, exclusions. |

### 3.2 Navigation

Top bar: `JH Job Hunter` wordmark, then `Jobs`, `Résumé`, `Settings`. Right side: small avatar circle. The onboarding flow uses its own step header instead of the app nav.

### 3.3 Jobs screen

- Six cards per page, two columns on desktop, one on mobile.
- Card: match badge, title, salary, company, location, posted age, two-line match rationale, up to three tech tags.
- The rationale is `match.explanation`, clamped to two lines. Fall back to the job description when the explanation is empty. The design’s snippet is a reason to look, not a copy of the posting.
- Footer: `Mark as applied`, `Hide`, `View on DOU.ua`.
- Selected card: blue hairline border and pale blue tint.
- Header: title, last sync line, search input, sort select (`Highest match first`, `Newest first`).
- Pagination: previous/next plus numbered pages.
- Drawer: match summary, actions (`Save`, `Mark as applied`, `Hide`, `View on DOU.ua`), matched competencies, gaps, full job overview. No AI buttons.
- Hidden job: remove immediately, show an undo toast. Undo clears the action.
- Empty state: “No ranked jobs yet” plus a button to run discovery and matching.
- Error state: inline banner with retry. Never silently show an empty list on a failed fetch.

### 3.4 Résumé screen

- Left column: identity card (name, headline, summary, location, timezone, email), competencies (technology and skill tags), experience entries, education and languages.
- Right column: matching weights (read-only), target roles summary with read-only location and currency, link to Settings.
- `Auto-rank DOU jobs` appears in the design but is disabled with a `v0.2` label. v0.1 has no background matching.
- `Upload PDF` / `Re-upload PDF` is disabled with a `v0.2` label.
- Replace the design’s archive copy. Say: `Vacancies scoring below your minimum match score are hidden from Jobs.`
- Editable form with an explicit `Save changes` button. No autosave.
- Copy must not claim the profile was parsed from a file.

### 3.5 Settings screen

- Source card: DOU.ua, active/primary, `https://jobs.dou.ua/vacancies/feeds/?category=Front+End&remote=`, last sync, `Refresh now`. Never show the HTML listing URL as the feed endpoint.
- Djinni card: disabled, “Ready to connect in v0.2”. `Add source` disabled.
- Role and tech filters.
- Work format checkboxes.
- Salary floor, currency, `Remove vacancies with undisclosed salary`.
- Minimum match score (default 75).
- Exclusion patterns. The design omitted this, but v0.1 matching needs it.
- `Reset to defaults` and `Save preferences`.
- Success toast after save; inline error on failure.

### 3.6 Onboarding

**Step 1 — Welcome.** Manual setup card is primary. Upload card is disabled with a `v0.2` label. Explanation of the three-stage pipeline (ingest, score, rank).

**Step 2 — Search preferences.** Read-only DOU source card (`Verified feed`, `Fetch automatically on save`, `up to 50 postings`). Target titles, core technologies, work formats, minimum monthly salary, hide-undisclosed toggle, minimum match score. Label the cutoff `Minimum match score`, not “notification cutoff”; it filters the list and sends nothing. A disabled `Or upload résumé instead` link mirrors the design. `Save preferences & fetch jobs`:
1. `PUT /api/profile`
2. `POST /api/discovery/run`
3. `POST /api/matching/run`
4. navigate to `/jobs`

If any step fails, stay on the page and show the failing step. Do not navigate with a partial setup.

## 4. Scoring decisions

The design fixes four visible weights: React ecosystem 40%, remote 30%, seniority 20%, compensation 10%. Target roles are a filter, not a fifth score component.

### 4.1 Role gate

A job is rankable only when its title matches at least one `desiredRoles` entry on normalized tokens. Lowercase, split on non-alphanumeric characters, treat `fullstack` as `full stack`, and ignore generic grade/function words (`engineer`, `developer`, `senior`, `junior`, `middle`, `lead`, `staff`, `principal`). Every remaining role token must appear in the title. If no role matches, `scoreJob` returns `0` and an explanation `Target role not matched`. The jobs query hides it because its score is below the default cutoff.

### 4.2 Components

| Component | Points | Rule |
|---|---:|---|
| Technology overlap | 40 | `40 × matched preferred technologies ÷ total preferred technologies`, rounded. Empty list contributes 0. Match with token boundaries over title + description. |
| Location / remote | 30 | 30 when the job is remote and the profile accepts any remote mode; otherwise 30 when the job location intersects a preferred country. |
| Seniority | 20 | 20 when `detectLevel(title)` is in `positionLevels`; 10 when no level is present; 0 when a detected level is outside the list. |
| Compensation | 10 | 10 when a salary is listed in the profile currency; 5 when undisclosed or in another currency; 0 when no salary preference exists. |

Exclusions override everything: `score = 0`, `excluded = true`, reasons retained. Excluded jobs are not shown in the default list.

### 4.3 Salary filter

- A listed salary below `jobProfile.salaryMin` is hidden.
- An undisclosed salary is hidden only when `hideUndisclosedSalary` is true.
- Currency mismatch is not compared numerically; treat it as undisclosed for filtering and scoring.
- v0.1 does not convert currencies. Only `USD` and `$` are compared to the profile currency.

### 4.4 Match cutoff

`jobProfile.minMatchScore` defaults to `75`. The jobs list returns only non-excluded, non-hidden jobs with `score >= minMatchScore`. This is a list filter only. It does not schedule notifications, emails, or background recalculation.

## 5. Data model changes

Add to the existing canonical model:

- `candidate.location`, `candidate.summary`, `candidate.timezone`, `candidate.education` (jsonb), `candidate.languages` (jsonb).
- `jobProfile.minMatchScore` integer default 75.
- `jobProfile.hideUndisclosedSalary` boolean default false.
- `jobAction`: `id`, `tenantId`, `userId`, `jobId`, `status` in `saved|applied|hidden`, timestamps, unique `(userId, jobId)`.
- `job.description` default must be `''`, not the literal `"''"`.
- Fixed `SINGLE_CANDIDATE_ID` and `SINGLE_JOB_PROFILE_ID` UUID constants. `SINGLE_USER_ID` is a text user key, not a candidate UUID.
- `DEFAULT_CANDIDATE` for the first onboarding save: `{ name: "You", email: "" }`. Onboarding collects no identity fields, and the schema requires `name` and `email`. The Résumé page lets the user replace both.

## 6. Design tokens

```css
--canvas: #f9fafb;
--surface: #ffffff;
--surface-subtle: #f3f4f6;
--border: #e5e7eb;
--border-strong: #d1d5db;
--ink: #111827;
--ink-secondary: #4b5563;
--ink-muted: #6b7280;
--ink-faint: #9ca3af;
--primary: #2563eb;
--primary-strong: #1d4ed8;
--accent-soft: #eff6ff;
--accent-border: #dbeafe;
--success: #16a34a;
--danger: #dc2626;
--radius-sm: 4px;
--radius: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--shadow-card: 0 1px 3px rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04);
--shadow-overlay: 0 10px 15px -3px rgb(0 0 0 / 0.04), 0 4px 6px -4px rgb(0 0 0 / 0.02);
```

Type: Inter, weights 400/500/600. Headline 36/24/18, body 16/14/13, labels 13/11. Cards use 1px borders and the card shadow, not heavy elevation. Buttons: primary `#111827` fill, secondary white with border, ghost text. Match badge: `accent-soft` background, `accent-border` border, blue text.

## 7. Deferred design features

These appear in the Stitch screens but are explicitly not v0.1:

- PDF/DOCX upload, résumé parsing, and résumé re-upload.
- AI résumé tailoring.
- Cover-letter generation.
- Notification cutoff delivery (the value is used only as a list filter).
- Auto-rank / background recalculation on new vacancy arrivals.
- Archive tab for below-cutoff vacancies.
- Djinni source and arbitrary source creation.
- Pipeline/kanban, application history, analytics.
- Dark mode.

## 8. Acceptance

- A first-time user can complete onboarding, ingest DOU jobs, score them, and land on a ranked list without touching the database.
- `/jobs` uses the design's card layout, match badge, drawer, and pagination. Card snippets show the match rationale.
- `/resume` is manually editable, shows read-only location and currency, and never claims parsed-file provenance.
- `/settings` persists every filter, shows the RSS feed endpoint, and can refresh DOU.
- Hidden/applied/saved state survives reloads.
- No AI SDK, PDF parser, cover-letter code, queue binding, or paid-plan instruction exists in the tree.
- `pnpm turbo run test`, `check-types`, and `lint` pass.
