import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { trackDataSpotifyReturnValue } from "../example-response-fusion";


const { mockRediscoverLovedTracks } = vi.hoisted(() => ({
    mockRediscoverLovedTracks: vi.fn()
}))

vi.mock("../../services/spotify.service", () => ({
    SpotifyService: class {
        syncAndCompare = mockRediscoverLovedTracks;
    },
}));

vi.mock("../../utils/spotifyUtils", () => ({
    throwIfCanceled: vi.fn().mockResolvedValue(undefined),
    JobCanceledError: class JobCanceledError extends Error {
        constructor(message?: string) {
            super(message || "JOB_CANCELED_OR_DELETED");
            this.name = "JOB_CANCELED_OR_DELETED";
        }
    }
}))


import { Queue, QueueEvents, Worker } from "bullmq";
import { redis } from "../../infra/redis";
import { rediscoverSpotifyWorker } from "../../workers/rediscoverSpotify.worker";
import { JobCanceledError } from "../../utils/spotifyUtils";
import { rediscoverSpotifyQueueEvents } from "../../queues/rediscoverSpotify.queue";
import { TimeRange } from "../../models/spotify.model";


describe("Worker Spotify", () => {

    let worker: Worker
    let queue: Queue
    let queueEvents: QueueEvents
    beforeAll(async () => {

        queue = new Queue("rediscover-loved-tracks-spotify", { connection: redis });
        queueEvents = new QueueEvents(
            "rediscover-loved-tracks-spotify",
            {
                connection: redis
            }
        )
        worker = rediscoverSpotifyWorker
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

    it("Should process a job and return successfully a log 'Job successful'", async () => {
        mockRediscoverLovedTracks.mockResolvedValue(trackDataSpotifyReturnValue)
        const jobData = {
            access_token: "fake-token-123",
            spotifyId: "fake-user",
            compare: {
                firstCompare: "long_term",
                secondCompare: "short_term"
            }
        }

        const job = await queue.add("rediscover-loved-tracks-spotify", jobData)
        const result = await job.waitUntilFinished(queueEvents);
        expect(result).toEqual(trackDataSpotifyReturnValue);
    })

    it("Should cancel job during processing - worker must abort", async () => {
        mockRediscoverLovedTracks.mockImplementationOnce(async (access_token: string,
            spotifyId: string,
            compareTimeRange: { firstCompare: TimeRange; secondCompare: TimeRange },
            job,
            signal) => {
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => resolve(trackDataSpotifyReturnValue), 5000)

                signal.addEventListener("abort", () => {
                    clearTimeout(timeoutId),
                        reject(new JobCanceledError())
                })
            })
        })

        const jobData = {
            access_token: "fake-token-123",
            spotifyId: "fake-user",
            compare: {
                firstCompare: "long_term",
                secondCompare: "short_term"
            }
        }


        const job = await queue.add("rediscover-loved-tracks-spotify", jobData)
        await new Promise((resolve) => setTimeout(resolve, 150))

        rediscoverSpotifyQueueEvents.emit("removed", { jobId: job.id!, prev: "" }, "0");
        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow(/JOB_CANCELED_OR_DELETED/)

    })

    it("Should fail the worker (e.g. invalid API key) - job must go to failed state", async () => {
        const apiError = new Error("Invalid API key or Unauthorized")
        mockRediscoverLovedTracks.mockRejectedValueOnce(apiError)

        const jobData = {
            access_token: "token-invalido-ou-expirado",
            spotifyId: "fake-user",
            compare: {
                firstCompare: "long_term",
                secondCompare: "short_term"
            }
        }

        const job = await queue.add("rediscover-loved-tracks-spotify", jobData)

        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow("Invalid API key or Unauthorized")

        // 4. A prova de fogo: Consultamos o BullMQ para saber o status do Job
        const state = await job.getState()
        expect(state).toBe("failed")

        const updatedJob = await queue.getJob(job.id!)
        expect(updatedJob!.failedReason).toContain("Invalid API key or Unauthorized")
    })
})