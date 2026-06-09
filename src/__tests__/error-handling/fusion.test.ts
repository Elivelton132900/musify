import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../../app";
import request from "supertest";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";
import { redis } from "../../infra/redis";
import { NextFunction } from "express";
import { TimeRange } from "../../models/spotify.model";
import jwt from "jsonwebtoken";

vi.mock("bullmq", async () => {
    const mod = await import("../__mocks__/bullmq.js")
    return mod.default
})

vi.mock("../../middlewares/job-with-same-url-exists-fusion.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}))

vi.mock("../../middlewares/is-authenticated.spotify.middleware", () => ({
    isAuthenticatedSpotify: (req: any, _res: Response, next: NextFunction) => {
        req.userId = "fakeUserId";
        req.spotifyToken = "fake-spotify-token-123";
        next();
    }
}))

describe("Cases of Error and Clean up", () => {

    let validCsrfToken: string
    let fakeSpotifyToken: string
    beforeAll(() => {
        validCsrfToken = generateCsrfToken()
        fakeSpotifyToken = jwt.sign(
            { access_token: "fake-spotify-token-123", spotifyId: "testspotifyid" },
            "secret-test"
        )
    })


    it("Should not found a job", async () => {
        const fakeJobId = "fake123"

        const response = await request(app)
            .get(`/fusion/loved-tracks/jobs/${fakeJobId}`)

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
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])
            .send('{"candidateFrom": "2026-05-06", }')

        expect(response.status).toBe(400)
    })

    it("Should not remove an active job from queue, only set caancel flag in Redis", async () => {
        const validPayload = {
            compare: {
                firstCompare: TimeRange.long,
                secondCompare: TimeRange.loved_tracks
            },
            lastFmUser: "test123"
        }


        const createResponse = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`, `spotify_token=${fakeSpotifyToken}`]).send(validPayload)

        const jobId = createResponse.body.jobId
        await new Promise((resolve) => setTimeout(resolve, 150))

        const deleteResponse = await request(app)
            .delete(`/fusion/loved-tracks/jobs/${jobId}/${validPayload.lastFmUser}/testspotifyid`)
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])

        expect(deleteResponse.status).toBe(200)
        expect(deleteResponse.body.status).toContain("deleted and marked as cancelled")

        const checkJobResponse = await request(app)
            .get(`/fusion/loved-tracks/jobs/${jobId}`)


        expect(checkJobResponse.status).toBe(200)

        const redisFlag = await redis.get(`rediscover:delete:${jobId}`)
        expect(redisFlag).toBe("1")
    })

    it("Should return failed or cancelled after cancel", async () => {
        const validPayload = {
            compare: {
                firstCompare: TimeRange.long,
                secondCompare: TimeRange.loved_tracks
            },
            lastFmUser: "test123"
        }

        const createResponse = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`, `spotify_token=${fakeSpotifyToken}`]).send(validPayload)

        const jobId = createResponse.body.jobId

        await new Promise((resolve) => setTimeout(resolve, 150))

        await request(app)
            .delete(`/fusion/loved-tracks/jobs/${jobId}/${validPayload.lastFmUser}/testspotifyid`)
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [`csrf_token=${validCsrfToken}`])

        const checkJobResponse = await request(app)
            .get(`/fusion/loved-tracks/jobs/${jobId}`)

        expect(checkJobResponse.status).toBe(200)

        const state = checkJobResponse.body.state
        expect(['failed', 'cancelled']).toContain(state)

        const redisFlag = await redis.get(`rediscover:delete:${jobId}`)
        expect(redisFlag).toBe("1")
    })
})