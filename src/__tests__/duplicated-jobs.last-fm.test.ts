import { describe, expect, it, vi } from "vitest";
import { NextFunction, Request, Response } from "express";
import request from "supertest";

vi.mock('ioredis', () => {
    class MockRedis {
        get = vi.fn().mockResolvedValue(null)
        set = vi.fn().mockResolvedValue("OK")
        del = vi.fn().mockResolvedValue(1)
        quit = vi.fn().mockResolvedValue("OK")
        on = vi.fn().mockReturnThis()
        status = "ready"
    }

    return {
        default: MockRedis
    }
})


vi.mock("axios", () => ({
    default: {
        get: vi.fn().mockResolvedValue({
            data: {
                user: {
                    registered: {
                        unixtime: "1263177600"
                    }
                }
            }
        })
    }
}))

vi.mock("../src/middlewares/csrf-protection.middleware", () => ({
    csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next()
}))


// Mock do jobWithSameUrlExists com contador
let callCount = 0

vi.mock("../middlewares/job-with-same-url-exists-last-fm.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, res: Response, next: NextFunction) => {
        callCount++

        if (callCount > 1) {
            res.status(409).json({ error: "Job already exists" })
            return
        }
        next()
    }


}))


import app from "../app";


describe("POST /lastfm/loved-tracks/jobs - duplicate jobs ", () => {

    it("Should return 409 when submitting the same job twice or more", async () => {
        callCount = 0

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
            .send(payload)

        console.log("Primeira: ", firstResponse.status)
        console.log("first ", firstResponse.error)
        console.log("first ", firstResponse.text)
        const secondResponse = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        console.log("Segunda: ", secondResponse.status)

        expect(firstResponse.status).toBe(202)
        expect(secondResponse.status).toBe(409)

    })

})