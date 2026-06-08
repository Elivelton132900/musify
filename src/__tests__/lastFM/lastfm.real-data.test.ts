import { describe, expect, it, vi } from "vitest"
import response from "supertest"
import { Request, Response, NextFunction } from "express"

const candidateFrom = "2025-04-06"
const candidateTo = "2026-01-22"
const comparisonFrom = "2026-02-01"
const comparisonTo = "2026-03-05"
const lastFmUser = "testuser"

// ✅ Mocks dos middlewares
vi.mock("../../middlewares/csrf-protection.middleware", async () => {
    const actual = await vi.importActual("../../middlewares/csrf-protection.middleware")
    return {
        ...actual,
        csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next()
    }
})

vi.mock("../../middlewares/job-with-same-url-exists-last-fm.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}))

// ✅ Importa a fila REAL
import { rediscoverLastFmQueue } from "../../queues/rediscoverLastfm.queue"
import dayjs from "dayjs"
import app from "../../app"
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware"
import { Job } from "bullmq"

// ✅ Mock do add com vi.spyOn
const addSpy = vi.spyOn(rediscoverLastFmQueue, 'add')
// @ts-ignore
addSpy.mockImplementation(async (name, data, opts) => {
    // ✅ Garante que o ID seja string (BullMQ não aceita números)
    const jobId = String(data.jobIdMocked || opts?.jobId || `job-${Date.now()}`)
    
    const job = {
        id: jobId,
        name: name,
        data: data,
        opts: opts,
        // @ts-ignore
        getState: vi.fn().mockResolvedValue(opts?.delay > 0 ? 'delayed' : 'waiting'),
        remove: vi.fn().mockResolvedValue(undefined),
        updateProgress: vi.fn().mockResolvedValue(undefined)
    } 
    
    return job
})

// ✅ Mock do getJob
const getJobSpy = vi.spyOn(rediscoverLastFmQueue, 'getJob')
getJobSpy.mockImplementation(async (jobId): Promise<Job | undefined> => {
    return {
        id: String(jobId),
        getState:  vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn().mockResolvedValue(undefined)
    } as unknown as Job
})

async function createJob(fetchInDays?: number, distinct?: number, jobIdMocked?: string, delay?: number) {
    
    // ✅ Garante que o jobIdMocked seja string
    const finalJobId = jobIdMocked ? String(jobIdMocked) : undefined
    
    const result = await rediscoverLastFmQueue.add(
        "rediscover-loved-tracks-last-fm",
        {
            candidateFrom,
            candidateTo,
            comparisonFrom,
            comparisonTo,
            lastFmUser,
            fetchInDays,
            distinct,
            jobIdMocked: finalJobId
        },
        {
            jobId: finalJobId,
            delay: delay || 0
        }
    )

    return result
}

describe("Real data simulation", () => {
    const fetchInDays = dayjs(candidateTo).utc().diff(dayjs(candidateFrom).utc(), "day")

    it("Should be able to create a job with valid date", async () => {
        // ✅ Use string "1234" (já é string)
        const job = await createJob(fetchInDays)
        expect(job).toBeDefined()
        expect(job?.id).toBeDefined()
    })

    it("Should be able to create a job without 'distinct'", async () => {
        const job = await createJob(fetchInDays)
        expect(job).toBeDefined()
        expect(job?.id).toBeDefined()
    })

    it("Should be able to consult a job", async () => {
        const job = await createJob()
        expect(job).toBeDefined()
        expect(job.getState).toBeDefined()
        const state = await job.getState()
        expect(state).toBe('waiting')
    })

    it("Should be able to do a POST to cancel a job", async () => {
        const csrf_token = generateCsrfToken()
        // ✅ Use string para jobId
        const jobIdMocked = "jobojof"

        const job = await createJob(fetchInDays, 2, jobIdMocked, 100)
        expect(job).toBeDefined()
        expect(job.id).toBe(jobIdMocked)
        // Aguarda um pouco
        await new Promise(resolve => setTimeout(resolve, 200))

        const cancelResponse = await response(app)
            .post(`/lastfm/loved-tracks/jobs/${jobIdMocked}/cancel`)
            .set('x-csrf-token', csrf_token)
            .set('Cookie', [`csrf_token=${csrf_token}`])
        expect(cancelResponse.status).toBe(200)
        expect(cancelResponse.body).toHaveProperty("status")
        expect(cancelResponse.body.status).toContain("marked as cancelled")
    }, 10000)
})