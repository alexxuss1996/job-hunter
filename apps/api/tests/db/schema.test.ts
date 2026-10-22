import { describe, expect, it } from "vitest";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import {
  JobActionInsert,
  JobInsert,
  JobProfileInsert,
  MatchInsert,
  job,
} from "../../src/db/schema";
import { createDb } from "../../src/db/client";

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

  it("rejects an inverted salary range", () => {
    const result = JobInsert({
      title: "Frontend Engineer",
      company: "Acme",
      fingerprint: "abc",
      salaryMin: 5000,
      salaryMax: 2000,
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects a score above 100", () => {
    const result = MatchInsert({
      candidateId: "00000000-0000-0000-0000-000000000001",
      jobId: "00000000-0000-0000-0000-000000000010",
      score: 101,
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects minMatchScore above 100", () => {
    const result = JobProfileInsert({
      candidateId: "00000000-0000-0000-0000-000000000001",
      minMatchScore: 101,
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("rejects an unknown action status", () => {
    const result = JobActionInsert({
      jobId: "00000000-0000-0000-0000-000000000010",
      status: "archived",
    });
    expect(result instanceof type.errors).toBe(true);
  });

  it("sets updatedAt automatically on update", () => {
    const db = createDb("postgresql://user:pass@host/db");
    const query = db
      .update(job)
      .set({ title: "Updated" })
      .where(eq(job.id, "00000000-0000-0000-0000-000000000010"))
      .toSQL();
    expect(query.sql).toContain('"updatedAt"');
  });
});
