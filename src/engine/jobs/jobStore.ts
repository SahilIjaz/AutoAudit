import { randomUUID } from "node:crypto";
import { CONFIG } from "../config";
import type { Job, JobPhase } from "../types";

export interface JobStore {
  create(input: { repoUrl: string; mode: Job["mode"] }): Job;
  get(id: string): Job | undefined;
  update(id: string, patch: Partial<Job>): void;
  appendEvent(id: string, phase: JobPhase, note?: string): void;
}

class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();

  create(input: { repoUrl: string; mode: Job["mode"] }): Job {
    this.sweep();
    const job: Job = {
      id: randomUUID(),
      repoUrl: input.repoUrl,
      mode: input.mode,
      phase: "queued",
      events: [{ at: Date.now(), phase: "queued" }],
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
  }

  appendEvent(id: string, phase: JobPhase, note?: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.phase = phase;
    job.events.push({ at: Date.now(), phase, note });
  }

  private sweep(): void {
    const cutoff = Date.now() - CONFIG.jobTtlMs;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}

// Behind a globalThis singleton so Next.js dev-mode module re-evaluation
// (and multiple route handlers) share one store.
const globalForStore = globalThis as unknown as { __autoauditJobStore?: JobStore };

export function getJobStore(): JobStore {
  if (!globalForStore.__autoauditJobStore) {
    globalForStore.__autoauditJobStore = new InMemoryJobStore();
  }
  return globalForStore.__autoauditJobStore;
}
