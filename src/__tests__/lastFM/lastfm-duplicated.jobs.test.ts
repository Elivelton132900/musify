import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextFunction, Request, Response } from "express";
import request from "supertest";
import  {Server} from "http"

vi.mock("../../infra/redis", () => ({
    redis: {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        on: vi.fn().mockReturnThis(),
        del: vi.fn().mockResolvedValue(1),
        status: "ready"
    }
}))

vi.mock("../../middlewares/resolve-date-defaults.middleware", async () => {
    const actual = await vi.importActual("../../middlewares/resolve-date-defaults.middleware");
    return {
        ...actual,
        userAccountCreation: vi.fn().mockResolvedValue("1263177600"), // timestamp fixo
    };
});


vi.mock("../../middlewares/user-exists-last-fm.middleware", async  () => ({
    checkUserExists: (req: Request, res: Response, next: NextFunction) => next()
}))

vi.mock("../../src/middlewares/csrf-protection.middleware", () => ({
    csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next()
}));

let callCount = 0;
vi.mock("../../middlewares/job-with-same-url-exists-last-fm.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, res: Response, next: NextFunction) => {
        callCount++;
        if (callCount > 1) {
            res.status(409).json({ error: "Job already exists" });
            return;
        }
        next();
    }
}));

import app from "../../app";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";
import { redis } from "../../infra/redis"

const validCsrfToken = generateCsrfToken()

describe("POST /lastfm/loved-tracks/jobs - duplicate jobs", () => {
    let server: Server

    beforeAll(async () => {
        server = app.listen(3333)
    })

    afterAll(async () => {
        await redis.quit
        vi.clearAllMocks()
        if (server) server.close()
    })


    it("Should return 409 when submitting the same job twice or more", async () => {
        callCount = 0; // reset

        const payload = {
            candidateFrom: "2023-05-06",
            candidateTo: "2023-05-22",
            comparisonFrom: "2023-05-01",
            comparisonTo: "2023-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        };

        const firstResponse = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send(payload);

        const secondResponse = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send(payload);

        expect(firstResponse.status).toBe(202);
        expect(secondResponse.status).toBe(409);
    });
});