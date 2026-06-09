import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../../app";
import request from "supertest";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";
import { redis } from "../../infra/redis";
import { NextFunction } from "express";

vi.mock("bullmq", async () => {
    const mod = await import("../__mocks__/bullmq.js")
    return mod.default
})

vi.mock("../../middlewares/job-with-same-url-exists-last-fm.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}))


describe("Cases of Error and Clean up", () => {

    let validCsrfToken: string

    beforeAll(() => {
        validCsrfToken = generateCsrfToken()
    })


    it("Should not found a job", async () => {
        const fakeJobId = "fake123"

        const response = await request(app)
            .get(`/lastfm/loved-tracks/jobs/${fakeJobId}`)

        expect(response.status).toBe(404)
    })

    it("Should return error when route does not exist", async () => {
        const response = await request(app)
            .get("/route/that/doesnt/exist")

        expect(response.status).toBe(404)
        expect(response.body.error).toBe("Route /route/that/doesnt/exist not found")
    })

    it("Should return error 400 if JSON syntax is completely broken", async () => {

        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send('{"candidateFrom": "2026-05-06", }')

        expect(response.status).toBe(400)
    })

    it("Should not remove an active job from queue, only set caancel flag in Redis", async () => {
        const validPayload = {
            candidateFrom: "2026-05-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-05-01",
            comparisonTo: "2026-05-05",
            distinct: 1,
            lastFmUser: "testuser",
        }

        const createResponse = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send(validPayload)


        const jobId = createResponse.body.jobId
        await new Promise((resolve) => setTimeout(resolve, 150))

        const deleteResponse = await request(app)
            .delete(`/lastfm/loved-tracks/jobs/${jobId}`)
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])

        expect(deleteResponse.status).toBe(200)
        expect(deleteResponse.body.status).toContain("deleted and marked as cancelled")

        const checkJobResponse = await request(app)
            .get(`/lastfm/loved-tracks/jobs/${jobId}`)


        expect(checkJobResponse.status).toBe(200)

        const redisFlag = await redis.get(`rediscover:delete:${jobId}`)
        expect(redisFlag).toBe("1")
    })

    it("Should return failed or cancelled after cancel", async () => {
        const validPayload = {
            candidateFrom: "2026-05-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-05-01",
            comparisonTo: "2026-05-05",
            distinct: 1,
            lastFmUser: "testuser",
        }

        const createResponse = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send(validPayload)

        const jobId = createResponse.body.jobId
        
        await new Promise((resolve) => setTimeout(resolve, 150))

        await request(app)
            .delete(`/lastfm/loved-tracks/jobs/${jobId}`)
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])

        const checkJobResponse = await request(app)
            .get(`/lastfm/loved-tracks/jobs/${jobId}`)

        expect(checkJobResponse.status).toBe(200)
        
        const state = checkJobResponse.body.state
        expect(['failed', 'cancelled']).toContain(state)

        const redisFlag = await redis.get(`rediscover:delete:${jobId}`)
        expect(redisFlag).toBe("1")
    })
})