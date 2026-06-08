import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { lastFmResponse } from "../exampe-response-last-fm";


const { mockRediscoverLovedTracks } = vi.hoisted(() => ({
    mockRediscoverLovedTracks: vi.fn()
}))
vi.mock("../../services/last-fm.service", () => {
    return {
        LastFmService: class {
            rediscoverLovedTracks = mockRediscoverLovedTracks
        }
    }
})


vi.mock("../../utils/lastFmUtils", () => ({
    throwIfCanceled: vi.fn().mockResolvedValue(undefined),
    JobCanceledError: class JobCanceledError extends Error {
        constructor(message?: string) {
            super(message || "JOB_CANCELED_OR_DELETED")
            this.name = "JOB_CANCELED_OR_DELETED"
        }
    },
}));


import { Queue, QueueEvents, Worker } from "bullmq";
import { redis } from "../../infra/redis";
import { rediscoverLastFmWorker } from "../../workers/rediscoverLastfm.worker";
import { RediscoverLovedTracksBody } from "../../models/last-fm.model";
import { JobCanceledError } from "../../utils/lastFmUtils";
import { rediscoverLastFmQueueEvents } from "../../queues/rediscoverLastfm.queue";
describe("Worker LastFm", () => {

    let worker: Worker
    let queue: Queue
    let queueEvents: QueueEvents
    beforeAll(async () => {

        queue = new Queue(
            "rediscover-loved-tracks-last-fm",
            {
                connection: redis
            }
        );
        queueEvents = new QueueEvents(
            "rediscover-loved-tracks-last-fm",
            {
                connection: redis
            }
        )
        worker = rediscoverLastFmWorker
        await worker.waitUntilReady();

        worker.on("completed", (job) => {
            console.log("COMPLETED:", job.id)
        })
    })

    afterAll(async () => {
        await worker.close()
        await queue.close()
        await queueEvents.close()
        vi.restoreAllMocks()
    })

    beforeEach(async () => {
        vi.clearAllMocks();
        const keys = await redis.keys('bull:rediscover-loved-tracks-last-fm:*')
        if (keys.length > 0) {
            await redis.del(...keys)
        }
    })

    it("Should process a job and return successfully a log 'Job successful'", async () => {
        mockRediscoverLovedTracks.mockResolvedValueOnce(lastFmResponse)
        const jobData: RediscoverLovedTracksBody = {
            "distinct": 2,
            "comparisonFrom": "2020-01-01",
            "comparisonTo": "2021-12-29",
            "candidateFrom": "2026-01-01",
            "candidateTo": "2026-06-03",
            "lastFmUser": "Elivelton1329"
        }
        const job = await queue.add("rediscover-loved-tracks-last-fm", jobData)
        const result = await job.waitUntilFinished(queueEvents);
        expect(result).toEqual(lastFmResponse);
    })

    it("Should cancel job during processing - worker must abort", async () => {
        mockRediscoverLovedTracks.mockImplementationOnce(async (username, queryParams, signal) => {
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => resolve(lastFmResponse), 5000)

                signal.addEventListener("abort", () => {
                    clearTimeout(timeoutId),
                        reject(new JobCanceledError())
                })
            })
        })

        const jobData: RediscoverLovedTracksBody = {
            "distinct": 2,
            "comparisonFrom": "2020-01-01",
            "comparisonTo": "2021-12-29",
            "candidateFrom": "2026-01-01",
            "candidateTo": "2026-06-03",
            "lastFmUser": "Elivelton1329",

        }

        const job = await queue.add("rediscover-loved-tracks-last-fm", jobData)
        await new Promise((resolve) => setTimeout(resolve, 150))

        rediscoverLastFmQueueEvents.emit("removed", { jobId: job.id!, prev: "" }, "0");
        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow(/JOB_CANCELED_OR_DELETED/)

    })
    it("Should fail the worker (e.g. invalid API key) - job must go to failed state", async () => {
        const apiError = new Error("Invalid API key or Unauthorized")
        mockRediscoverLovedTracks.mockRejectedValueOnce(apiError)
        const jobData: RediscoverLovedTracksBody = {
            "distinct": 2,
            "comparisonFrom": "2020-01-01",
            "comparisonTo": "2021-12-29",
            "candidateFrom": "2026-01-01",
            "candidateTo": "2026-06-03",
            "lastFmUser": "Elivelton1329",

        }

        const job = await queue.add("rediscover-loved-tracks-last-fm", jobData)

        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow("Invalid API key or Unauthorized")

        // 4. A prova de fogo: Consultamos o BullMQ para saber o status do Job
        const state = await job.getState()
        expect(state).toBe("failed")

        const updatedJob = await queue.getJob(job.id!)
        expect(updatedJob!.failedReason).toContain("Invalid API key or Unauthorized")
    })
})