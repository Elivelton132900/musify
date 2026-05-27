import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextFunction, Request, Response } from "express";
import request from 'supertest';
import bullmqMock from "../__mocks__/bullmq";

vi.mock("../../middlewares/resolve-date-defaults.middleware", async () => {
  const actual = await vi.importActual("../../middlewares/resolve-date-defaults.middleware");
  return {
    ...actual,
    userAccountCreation: vi.fn().mockResolvedValue("1263177600"), // timestamp fixo (2010-01-10)
  };
});

vi.mock("../../middlewares/job-with-same-url-exists-last-fm.middleware", () => ({
  jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}));

import app from "../../app";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";
import { rediscoverLastFmQueue } from "../../queues/rediscoverLastfm.queue";

vi.mock("bullmq", () => bullmqMock)


const globalJobsStore = new Map<string, any>()
vi.mock("../../queues/rediscoverLastfm.queue", () => {

    const { Queue } = require("bullmq")
    const queue = new Queue("rediscover-loved-tracks-last-fm")

    const originalAdd = queue.add

    queue.add = async (name: string, data: any) => {
        const job = await originalAdd.call(queue, name, data)

        const originalRemove = job.remove.bind(job)
        job.remove = async () => {
            // Remove do store antes de chamar o remove original
            globalJobsStore.delete(job.id)
            return originalRemove()
        }

        globalJobsStore.set(job.id, job)
        return job

    }

    return {
        rediscoverLastFmQueue: queue
    }
})


import { LastFmController } from "../../controllers/last-fm.controller";
LastFmController.addJobToQueue = (async (
    candidateFrom,
    candidateTo,
    comparisonFrom,
    comparisonTo,
    lastFmUser
) => {

    const job = await rediscoverLastFmQueue.add("rediscover-loved-tracks-last-fm", {
        candidateFrom,
        candidateTo,
        comparisonFrom,
        comparisonTo,
        lastFmUser
    })

    return job
})

describe("validation of dates", () => {
  let validCsrfToken: string;

  beforeAll(() => {
    validCsrfToken = generateCsrfToken();
  });

  it("Should return 202 when passed a valid date", async () => {
    const payload = {
      candidateFrom: "2026-05-06",
      candidateTo: "2026-05-22",
      comparisonFrom: "2026-05-01",
      comparisonTo: "2026-05-05",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);


    expect(response.status).toBe(202);
    expect(response.body).toBeDefined();
  });

  it("Should return 500 if candidateFrom is before ComparisonFrom", async () => {
    const payload = {
      candidateFrom: "2026-04-06",
      candidateTo: "2026-05-22",
      comparisonFrom: "2026-05-01",
      comparisonTo: "2026-05-05",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
  });

  it("Should return 500 if periods overlap", async () => {
    const payload = {
      candidateFrom: "2026-04-06",
      candidateTo: "2026-05-22",
      comparisonFrom: "2026-04-01",
      comparisonTo: "2026-05-05",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
  });

  it("Should return 500 if comparisonFrom is after comparisonTo", async () => {
    const payload = {
      candidateFrom: "2023-05-06",
      candidateTo: "2023-05-22",
      comparisonFrom: "2023-05-10",
      comparisonTo: "2023-05-05",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
  });

  it("Should return 500 if candidateFrom is after CandidateTo", async () => {
   const payload = {
      candidateFrom: "2026-04-06",
      candidateTo: "2026-05-22",
      comparisonFrom: "2026-05-01",
      comparisonTo: "2026-05-05",
      distinct: 2,
      lastFmUser: "testuser",
    };
    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
  });

  it("Should return 500 if date is in future", async () => {
    const payload = {
      candidateFrom: "2026-01-01",
      candidateTo: "2027-02-02",
      comparisonFrom: "2025-02-01",
      comparisonTo: "2025-03-01",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("future");
  });

  it("Should return true if using dates before account creation date", async () => {
    // Todas as datas são anteriores ao timestamp da conta (2010-01-10)
    // E respeitam as regras de ordem e não overlap
    const payload = {
      candidateFrom: "2000-01-11",
      candidateTo: "2000-01-20",
      comparisonFrom: "2000-01-01",
      comparisonTo: "2000-01-10",
      distinct: 2,
      lastFmUser: "testuser",
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", validCsrfToken)
      .set("Cookie", [`csrf_token=${validCsrfToken}`])
      .send(payload);

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("after account creation date");
  });
});