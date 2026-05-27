import bullmqMock from "../__mocks__/bullmq"
vi.mock("bullmq", () => bullmqMock)


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

const globalJobsStore = new Map<string, any>()
vi.mock("../../queues/rediscoverSpotify.queue", () => {

    const { Queue } = require("bullmq")
    const queue = new Queue("rediscover-loved-tracks-spotify")

    const originalAdd = queue.add

    queue.add = async (name: string, data: any) => {
        const job = await originalAdd.call(queue, name, data)

        const originalRemove = job.remove.bind(job)
        job.remove = async () => {
            globalJobsStore.delete(job.id)
            return originalRemove()
        }

        globalJobsStore.set(job.id, job)
        return job

    }

    queue.getJob = async (id: string) => {
        return globalJobsStore.get(id) || null
    }

    return {
        rediscoverSpotifyQueue: queue
    }

})
vi.mock("../../middlewares/is-authenticated.spotify.middleware", () => ({
    isAuthenticatedSpotify: (req: any, _res: any, next: any) => {
        const userData = {
            id: "123",
            access_token: "fake-access-token-123",
            spotifyId: "fake-spotify-user-id-alternative-2",
            refresh_token: "fake-refresh-token",
            expires_in: 3600,
            token_type: "Bearer"
        }
        req.spotifyUser = userData
        req.user = userData
        next()
    }
}))

vi.mock("../../middlewares/job-with-same-url-exists-spotify.middleware", () => ({
    jobWithSameUrlExists: (_req: any, _res: any, next: any) => next()
}))

vi.mock("../../middlewares/csrf-protection.middleware", () => ({
    csrfProtection: (_req: any, _res: any, next: any) => next(),
    generateCsrfToken: () => "mock-csrf-token-123"
}))

vi.mock("../../utils/auth.utils", () => ({
    verifySpotifyToken: vi.fn().mockResolvedValue({
        spotifyId: "fake-id",
        access_token: "fake-token"
    }),
    getSpotifyUser: vi.fn().mockResolvedValue({
        spotifyId: "fake-id",
        access_token: "fake-token"
    })
}))

vi.mock("express-async-handler", () => ({
    default: <T>(fn: T) => fn
}))

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"


const ranges = ["long_short", "long_medium", "medium_short", "long_loved", "short_loved", "medium_loved"] as const


import { rediscoverSpotifyQueue } from "../../queues/rediscoverSpotify.queue"



import { SpotifyController } from "../../controllers/spotify.controller"
SpotifyController.addJobToQueue = (async (access_token: string, spotifyId: string, compare: { firstCompare: TimeRange, secondCompare: TimeRange.loved_tracks }) => {
    const job = await rediscoverSpotifyQueue.add("rediscover-loved-tracks-spotify", {
        access_token,
        spotifyId,
        compare,
        params: {
            spotifyId,
            compare
        }
    })

    return job
}) as any;
import app from "../../app"
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware"
import { TimeRange } from "../../models/spotify.model"

describe("CRUD - Spotify | Teste integrado", () => {

    describe("POST /spotify/loved-tracks/comparison-jobs", () => {
        it("Should return 202 and jobId for each range", async () => {
            for (const term of ranges) {
                const response = await request(app)
                    .post("/spotify/loved-tracks/comparison-jobs")
                    .set("x-csrf-token", "mock-csrf-token-123")
                    .set("Cookie", ["csrf_token=mock-csrf-token-123"])
                    .set("Authorization", "Bearer fake-token-123")
                    .send({ range: term })
                expect(response.status).toBe(202)
                expect(response.body).toHaveProperty("jobId")
                expect(response.body.status).toBe("processing")
            }
        })
    })

    describe("GET /spotify/loved-tracks/jobs/:jobId", () => {
        let jobId: string
        const csrfToken = "123"

        beforeEach(async () => {
            const response = await request(app)
                .post("/spotify/loved-tracks/comparison-jobs")
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [
                    `csrf_token=${csrfToken}`,
                    "spotify_token=fake-token-123",
                    "spotify_refresh_token=fake-refresh-token"
                ])
                .set("Authorization", "Bearer fake-token-123")
                .set("x-access-token", "fake-token-123")
                .set("Content-Type", "application/json")
                .send({ range: "long_short" })
                .expect(202)

            jobId = response.body.jobId
        })

        it("Should verify state and result of a job", async () => {
            const getResponse = await request(app)
                .get(`/spotify/loved-tracks/jobs/${jobId}`)
                .set("x-csrf-token", "mock-csrf-token-123")
                .set("Cookie", ["csrf_token=mock-csrf-token-123"])
                .set("Authorization", "Bearer fake-token-123")
                .expect(200)
            expect(getResponse.body).toHaveProperty("state")
            expect(getResponse.body).toHaveProperty("result")
            expect(getResponse.body).toHaveProperty("length")
        })
    })

    describe("POST should mark a job to cancel", () => {
        let jobId: string
        const csrfToken = "123"

        beforeEach(async () => {
            const response = await request(app)
                .post("/spotify/loved-tracks/comparison-jobs")
                .send({ range: "long_short" })
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [
                    `csrf_token=${csrfToken}`,
                    "spotify_token=fake-token-123",
                    "spotify_refresh_token=fake-refresh-token"
                ])
                .expect(202)

            jobId = response.body.jobId
        })

        it("Should cancel an active job", async () => {
            const response = await request(app)
                .post(`/spotify/loved-tracks/jobs/${jobId}/cancel`)
                .set("x-csrf-token", "mock-csrf-token-123")
                .set("Cookie", ["csrf_token=mock-csrf-token-123"])
                .set("Authorization", "Bearer fake-token-123")
                .expect(200)

            expect(response.body).toHaveProperty("status")
            expect(response.body.status).toContain("cancelled")
        })

        it("Should return 404 when cancelling non-existent job", async () => {
            const fakeJobId = "non-existent-job-id"

            const response = await request(app)
                .post(`/spotify/loved-tracks/jobs/${fakeJobId}/cancel`)
                .set("x-csrf-token", "mock-csrf-token-123")
                .set("Cookie", ["csrf_token=mock-csrf-token-123"])
                .set("Authorization", "Bearer fake-token-123")
                .expect(404)

            expect(response.body).toHaveProperty("error")
        })
    })

    describe("DELETE a job in route /spotify/loved-tracks/jobs/:jobId", () => {
        let jobId: string
        const csrfToken = "123"
        let response: request.Response

        beforeEach(async () => {
            response = await request(app)
                .post("/spotify/loved-tracks/comparison-jobs")
                .send({ range: "long_short" })
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [
                    `csrf_token=${csrfToken}`,
                    "spotify_token=fake-token-123",
                    "spotify_refresh_token=fake-refresh-token"
                ])
                .set("Authorization", "Bearer fake-token-123")
                .set("x-access-token", "fake-token-123")
                .expect(202)

            jobId = response.body.jobId
        })

        it("Should delete a job and not letting a deleted job getting deleted again", async () => {
            const firstDelete = await request(app)
                .delete(`/spotify/loved-tracks/jobs/${jobId}`)
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [`csrf_token=${csrfToken}`])

            expect(firstDelete.status).toBe(200)
            expect(firstDelete.body).toMatchObject({
                status: expect.stringContaining("deleted")
            })

            const secondDelete = await request(app)
                .delete(`/spotify/loved-tracks/jobs/${jobId}`)
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [`csrf_token=${csrfToken}`])

            expect(secondDelete.status).toBe(404)
            expect(secondDelete.body).toMatchObject({
                error: expect.stringContaining("was not founded")
            })
        })
    })

    describe("GET jobs from an only particular user", () => {
        let validCsrfToken: string

        beforeAll(() => {
            validCsrfToken = generateCsrfToken()
        })

        it("Should return jobs from a particular logged user in route /spotify/loved-tracks/jobs", async () => {
            const targetSpotifyId = "fake-spotify-user-id"

            const response = await request(app)
                .get("/spotify/loved-tracks/jobs")
                .set("x-csrf-token", validCsrfToken)
                .set("Cookie", [`csrf_token=${validCsrfToken}`])

            expect(response.status).toBe(200)
            expect(response.body).toHaveProperty("jobs")
            expect(response.body).toHaveProperty("timeStamp")

            const allJobs = await rediscoverSpotifyQueue.getJobs([])
            const jobsFiltered = allJobs.filter((job) => job.data?.params?.spotifyId === targetSpotifyId)

            jobsFiltered.forEach((job) => {
                expect(job.data?.params?.spotifyId).not.toHaveLength(0)
            })
        })
    })
})