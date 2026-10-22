import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/arktype";
import { type } from "arktype";

export type LanguageEntry = { language: string; level: string };
export type EducationEntry = { degree: string; school: string; years: number };
export type ExperienceEntry = {
  company: string;
  role: string;
  startDate: string;
  endDate: string | null;
  description?: string;
};

export const SINGLE_CANDIDATE_ID = "00000000-0000-0000-0000-000000000001";
export const SINGLE_JOB_PROFILE_ID = "00000000-0000-0000-0000-000000000002";

const createdAt = timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp({ withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

const salaryRangeCheck = (table: {
  salaryMin: unknown;
  salaryMax: unknown;
}) =>
  sql`(${table.salaryMin} IS NULL OR ${table.salaryMin} >= 0) AND (${table.salaryMax} IS NULL OR ${table.salaryMax} >= 0) AND (${table.salaryMin} IS NULL OR ${table.salaryMax} IS NULL OR ${table.salaryMin} <= ${table.salaryMax})`;

export const job = pgTable(
  "job",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    title: text().notNull(),
    company: text().notNull(),
    location: text().notNull().default(""),
    isRemote: boolean().notNull().default(false),
    description: text().notNull().default(""),
    postedAt: timestamp({ withTimezone: true }),
    salaryMin: integer(),
    salaryMax: integer(),
    salaryCurrency: text(),
    postingUrl: text(),
    fingerprint: text().notNull(),
    sourceJobCount: integer().notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("job_fingerprint_idx").on(table.fingerprint),
    index("job_posted_at_idx").on(table.postedAt),
    check("job_salary_range_check", salaryRangeCheck(table)),
  ],
);

export const jobSource = pgTable(
  "job_source",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    key: text().notNull(),
    name: text().notNull(),
    integrationType: text().notNull(),
    lastSyncedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("job_source_key_idx").on(table.key),
    check(
      "job_source_integration_type_check",
      sql`${table.integrationType} IN ('api', 'scraper', 'upload')`,
    ),
  ],
);

export const sourceJob = pgTable(
  "source_job",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    sourceId: uuid()
      .notNull()
      .references(() => jobSource.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    raw: jsonb().$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_job_source_external_idx").on(
      table.sourceId,
      table.externalId,
    ),
    index("source_job_job_id_idx").on(table.jobId),
  ],
);

export const candidate = pgTable("candidate", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull(),
  headline: text(),
  summary: text().notNull().default(""),
  location: text().notNull().default(""),
  timezone: text().notNull().default(""),
  experience: jsonb().$type<ExperienceEntry[]>().notNull().default([]),
  skills: jsonb().$type<string[]>().notNull().default([]),
  technologies: jsonb().$type<string[]>().notNull().default([]),
  education: jsonb().$type<EducationEntry[]>().notNull().default([]),
  languages: jsonb().$type<LanguageEntry[]>().notNull().default([]),
  cvUrl: text(),
  createdAt,
  updatedAt,
});

export const jobProfile = pgTable(
  "job_profile",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    candidateId: uuid()
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    desiredRoles: jsonb().$type<string[]>().notNull().default([]),
    locations: jsonb().$type<string[]>().notNull().default([]),
    workModes: jsonb().$type<string[]>().notNull().default([]),
    salaryMin: integer(),
    salaryMax: integer(),
    salaryCurrency: text().default("USD"),
    preferredTechnologies: jsonb().$type<string[]>().notNull().default([]),
    exclusionPatterns: jsonb().$type<string[]>().notNull().default([]),
    positionLevels: jsonb().$type<string[]>().notNull().default([]),
    minMatchScore: integer().notNull().default(75),
    hideUndisclosedSalary: boolean().notNull().default(false),
    updatedAt,
  },
  (table) => [
    uniqueIndex("job_profile_candidate_id_idx").on(table.candidateId),
    check("job_profile_salary_range_check", salaryRangeCheck(table)),
    check(
      "job_profile_min_match_score_check",
      sql`${table.minMatchScore} BETWEEN 0 AND 100`,
    ),
  ],
);

export const match = pgTable(
  "match",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    candidateId: uuid()
      .notNull()
      .references(() => candidate.id, { onDelete: "cascade" }),
    jobId: uuid()
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    score: integer().notNull(),
    matchedSignals: jsonb().$type<string[]>().notNull().default([]),
    missingSignals: jsonb().$type<string[]>().notNull().default([]),
    excluded: boolean().notNull().default(false),
    exclusionReasons: jsonb().$type<string[]>().notNull().default([]),
    explanation: text().notNull().default(""),
    computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_candidate_job_idx").on(table.candidateId, table.jobId),
    index("match_job_id_idx").on(table.jobId),
    check("match_score_check", sql`${table.score} BETWEEN 0 AND 100`),
  ],
);

export const jobAction = pgTable(
  "job_action",
  {
    id: uuid().notNull().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    status: text().notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("job_action_job_id_idx").on(table.jobId),
    check(
      "job_action_status_check",
      sql`${table.status} IN ('saved', 'applied', 'hidden')`,
    ),
  ],
);

const hasValidSalaryRange = (value: {
  salaryMin?: number | null;
  salaryMax?: number | null;
}) =>
  value.salaryMin == null ||
  value.salaryMax == null ||
  value.salaryMin <= value.salaryMax;

export const JobInsert = createInsertSchema(job, {
  salaryMin: (schema) => schema.and(type("number.integer >= 0")),
  salaryMax: (schema) => schema.and(type("number.integer >= 0")),
}).narrow(hasValidSalaryRange);
export const JobSelect = createSelectSchema(job);
export const CandidateInsert = createInsertSchema(candidate);
export const CandidateSelect = createSelectSchema(candidate);
export const JobProfileInsert = createInsertSchema(jobProfile, {
  minMatchScore: (schema) =>
    schema.and(type("number.integer >= 0")).and(type("number.integer <= 100")),
  salaryMin: (schema) => schema.and(type("number.integer >= 0")),
  salaryMax: (schema) => schema.and(type("number.integer >= 0")),
}).narrow(hasValidSalaryRange);
export const JobProfileSelect = createSelectSchema(jobProfile);
export const MatchInsert = createInsertSchema(match, {
  score: (schema) =>
    schema.and(type("number.integer >= 0")).and(type("number.integer <= 100")),
});
export const MatchSelect = createSelectSchema(match);
export const SourceJobInsert = createInsertSchema(sourceJob);
export const JobActionInsert = createInsertSchema(jobAction, {
  status: type.enumerated("saved", "applied", "hidden"),
});
