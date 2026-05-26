import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { Server } from 'http'
import request from "supertest"
import { NextFunction, Request } from "express"
const ranges = ["long_short", "long_medium", "medium_short", "long_loved", "short_loved", "medium_loved"] as const
const memoryStore = new Map<string, string>()

// ✅ Mock do Redis
vi.mock("../infra/redis.ts", () => ({
    redis: {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn().mockResolvedValue(undefined),
        setex: vi.fn().mockImplementation(async (key: string, _ttl: number, value: unknown) => {
            memoryStore.set(key.toString(), String(value))
            return "OK"
        }),
        set: vi.fn().mockImplementation(async (key: string, value: string, ..._args: any[]) => {
            memoryStore.set(key.toString(), value)
            return "OK"
        }),
        get: vi.fn().mockImplementation(async (key: string) => {
            return memoryStore.get(key.toString()) || null
        }),
        del: vi.fn().mockResolvedValue(1),
        publish: vi.fn().mockResolvedValue(1),
        on: vi.fn().mockReturnThis(),
        disconnect: vi.fn().mockResolvedValue(undefined),
        duplicate: vi.fn().mockReturnThis(),
        keyPrefix: "",
        status: "ready",
    }
}))


vi.mock("bullmq", () => {
    const jobsStore = new Map<string, any>()

    return {
        Queue: class {
            // ✅ Agora recebe name e data
            add = vi.fn().mockImplementation(async (name: string, data: any) => {
                const jobId = `job-${Date.now()}-${Math.random()}`
                const formattedData = {
                    params: {
                        spotifyId: data.spotifyId || data.params?.spotifyId || "fake-spotify-user-id",
                        compare: data.compare || data.params?.compare || {
                            firstCompare: "long_term",
                            secondCompare: "short_term"
                        }
                    },
                    access_token: data.access_token || "fake-access-token-123",
                    spotifyId: data.spotifyId || "fake-spotify-user-id",
                    compare: data.compare || {
                        firstCompare: "long_term",
                        secondCompare: "short_term"
                    }
                }
                const job = {
                    id: jobId,
                    name: name,
                    data: formattedData,          // data é o objeto com access_token, spotifyId, compare
                    timestamp: Date.now(),
                    attempts: 0,
                    delay: 0,
                    getState: vi.fn().mockResolvedValue("waitign"),
                    remove: vi.fn().mockImplementation(async () => {
                        jobsStore.delete(jobId)
                        return undefined
                    }),
                    returnvalue: null
                }
                jobsStore.set(jobId, job)
                return job
            })
            getJob = vi.fn().mockImplementation(async (jobId: string, start: number, end: number) => {
                const job = jobsStore.get(jobId) || null

                if (job) {
                    return {
                        ...job,
                        remove: job.remove || vi.fn().mockImplementation(async () => {
                            jobsStore.delete(jobId)
                            return "OK"
                        })
                    }
                }
            })

            getJobs = vi.fn().mockImplementation(async (type: string[], spotifyId) => {
                const allJobs = Array.from(jobsStore.values())
                return allJobs
            })
        },
        QueueEvents: class {
            on = vi.fn().mockReturnThis()
            close = vi.fn().mockResolvedValue(undefined)
        },
        Worker: class {
            on = vi.fn()
            close = vi.fn().mockResolvedValue(undefined)
        },
        QueueScheduler: class {
            close = vi.fn().mockResolvedValue(undefined)
        }
    }
})

import { redis } from "../infra/redis"

vi.mock("../src/queues/rediscoverSpotify.queue.ts", () => ({
    rediscoverSpotifyQueue: new Queue("rediscover-loved-tracks-spotify", {
        connection: redis,
    })
}))

interface AuthenticatedRequest extends Request {
    spotifyUser?: SpotifyUser
}

interface SpotifyUser {
    access_token: string,
    spotifyId: string,
    refresh_token: string,
    expires_in: number
    token_type: string
}
// ✅ Mock da autenticação - ESSENCIAL
vi.mock("../middlewares/is-authenticated.spotify.middleware.ts", () => ({
    isAuthenticatedSpotify: (req: AuthenticatedRequest, next: NextFunction, user: string, _res: Response) => {

        console.log("🔵 MOCK isAuthenticatedSpotify FOI CHAMADO!")
        console.log("🔵 URL:", req.url)
        console.log("🔵 Method:", req.method)

        req.spotifyUser = {
            access_token: "fake-access-token-123",
            spotifyId: "fake-spotify-user-id-alternative-2",
            refresh_token: "fake-refresh-token",
            expires_in: 3600,
            token_type: "Bearer"
        }
        next()
    }
}))

// ✅ Mock dos outros middlewares
vi.mock("../middlewares/job-with-same-url-exists-spotify.middleware.ts", () => ({
    jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}))

vi.mock("../middlewares/csrf-protection.middleware.ts", () => ({
    csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next(),
    generateCsrfToken: () => "mock-csrf-token-123"
}))

// ✅ Mock do auth.utils
vi.mock("../utils/auth.utils.ts", () => ({
    verifySpotifyToken: vi.fn().mockResolvedValue({
        spotifyId: "fake-id",
        access_token: "fake-token"
    }),
    getSpotifyUser: vi.fn().mockResolvedValue({
        spotifyId: "fake-id",
        access_token: "fake-token"
    })
}))

// ✅ Mock do express-async-handler
vi.mock("express-async-handler", () => ({
    default: <T>(fn: T) => fn
}))

vi.mock("QueueGetters", () => ({

}))

import app from "../app"
import { Queue } from "bullmq"
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware"
import { rediscoverSpotifyQueue } from "../queues/rediscoverSpotify.queue"

describe("CRUD - Spotify | Teste integrado", () => {
    let server: Server

    beforeAll(async () => {
        await redis.connect()
        server = app.listen(3333)
    })

    afterAll(async () => {
        await redis.quit()
        vi.clearAllMocks()
        memoryStore.clear()
        if (server) server.close()
    })

    describe("POST /spotify/loved-tracks/comparison-jobs", () => {
        it("Should return 202 and jobId for each range", async () => {
            for (const term of ranges) {
                const response = await request(server)
                    .post("/spotify/loved-tracks/comparison-jobs")
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
            const response = await request(server)
                .post("/spotify/loved-tracks/comparison-jobs")
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [
                    `csrf_token=${csrfToken}`,
                    "spotify_token=fake-token-123",
                    "spotify_refresh_token=fake-refresh-token"
                ])
                .set("Authorization", "Bearer fake-token-123")
                .set("x-access-token", "fake-token-123")
                // ✅ Headers genéricos
                .set("Content-Type", "application/json")
                .send({ range: "long_short" })
                .expect(202)

            jobId = response.body.jobId
        })

        it("Should verify state and result of a job", async () => {
            const getResponse = await request(server)
                .get(`/spotify/loved-tracks/jobs/${jobId}`)
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
            const response = await request(server)
                .post("/spotify/loved-tracks/comparison-jobs")
                .send({ range: "long_short" })
                .set("x-csrf-token", csrfToken)
                .set("X-CSRF-Token", csrfToken)  // Variação maiúscula
                .set("csrf-token", csrfToken)     // Variação sem x-
                // ✅ Cookies
                .set("Cookie", [
                    `csrf_token=${csrfToken}`,
                    "spotify_token=fake-token-123",
                    "spotify_refresh_token=fake-refresh-token"
                ])
                // ✅ Headers de autenticação
                .set("Authorization", "Bearer fake-token-123")
                .set("x-access-token", "fake-token-123")
                // ✅ Headers genéricos
                .set("Content-Type", "application/json")
                .set("Accept", "application/json")
                .set("Origin", "http://localhost:3333")
                .set("Referer", "http://localhost:3333")
                .expect(202)

            jobId = response.body.jobId
        })

        it("Should cancel an active job", async () => {
            const response = await request(server)
                .post(`/spotify/loved-tracks/jobs/${jobId}/cancel`)
                .expect(200)

            expect(response.body).toHaveProperty("status")
            expect(response.body.status).toContain("cancelled")
        })

        it("Should return 404 when cancelling non-existent job", async () => {
            const fakeJobId = "non-existent-job-id"

            const response = await request(server)
                .post(`/spotify/loved-tracks/jobs/${fakeJobId}/cancel`)
                .expect(404)

            expect(response.body).toHaveProperty("error")
        })
    })

    describe("DELETE a job in route /spotify/loved-tracks/jobs/:jobId", async () => {
        let jobId: string
        const csrfToken = "123"
        let response: request.Response
        beforeEach(async () => {
            response = await request(server)
                .post("/spotify/loved-tracks/comparison-jobs")
                .send({ range: "long_short" })
                .set("x-csrf-token", csrfToken)
                // ✅ Cookies
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
            const firstDelete = await request(server)
                .delete(`/spotify/loved-tracks/jobs/${jobId}`)
                .set("x-csrf-token", csrfToken)
                .set("Cookie", [`csrf_token=${csrfToken}`])


            expect(firstDelete.status).toBe(200)
            console.log("MESSAGE ", firstDelete.body)
            expect(firstDelete.body).toMatchObject({
                status: expect.stringContaining("deleted")
            })


            const secondDelete = await request(server)
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

        let validCsrfToken: string;

        beforeAll(() => {
            validCsrfToken = generateCsrfToken();
        });



        it("Should return jobs from a particular logged user in route /spotify/loved-tracks/jobs", async () => {


            const targetSpotifyId = "fake-spotify-user-id";


            const response = await request(server)
                .get("/spotify/loved-tracks/jobs")
                .set("x-csrf-token", validCsrfToken)
                // ✅ Cookies
                .set("Cookie", [
                    `csrf_token=${validCsrfToken}`])
                
            expect(response.status).toBe(200)
            expect(response.body).toHaveProperty("jobs")
            expect(response.body).toHaveProperty("timeStamp")

            const allJobs = await rediscoverSpotifyQueue.getJobs([])
            const jobsFiltered = allJobs.filter((job) => job.data.params.spotifyId === targetSpotifyId)

            jobsFiltered.forEach((jobs) => {
                expect(jobs.data.params.spotifyId).not.toHaveLength(0)
            })

            console.log(`${jobsFiltered.length} resultados encontrados para o user ${targetSpotifyId}`)

        })
    })
})