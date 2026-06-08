import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/fusionUtils", () => ({
    throwIfCanceledFusion: vi.fn().mockResolvedValue(undefined),
    JobCanceledError: class JobCanceledError extends Error { },
}));


import { Queue, QueueEvents, Worker } from "bullmq";
import { redis } from "../../infra/redis";
import { trackDataSpotifyReturnValue } from "../example-response-fusion";
import { rediscoverFusionWorker } from "../../workers/rediscoverFusion.worker";
import { TimeRange } from "../../models/spotify.model";
import { rediscoverFusionQueueEvents } from "../../queues/rediscoverFusion.queue";
import { beforeEach } from "vitest";

const {
    mockThrowIfCanceledFusion,
    mockFetchTracksNotInCacheLovedTracks,
    mockFetchSingleRangeNotInCache,
    mockFetchLastFmNotInCache,
    mockDescompressMusics,
    mockFilterByLastFmHistory
} = vi.hoisted(() => ({
    mockThrowIfCanceledFusion: vi.fn().mockResolvedValue(undefined),

    mockFetchTracksNotInCacheLovedTracks: vi.fn(async (...args: any[]) => {
        await redis.set(`fusion:users:fake-spotify-id:${TimeRange.loved_tracks}`, JSON.stringify([{ id: 1 }]));
    }),

    mockFetchSingleRangeNotInCache: vi.fn(async () => {
        await redis.set(`fusion:users:fake-spotify-id:${TimeRange.long}`, JSON.stringify([{ id: 1 }]));
    }),

    mockFetchLastFmNotInCache: vi.fn(async () => {
        await redis.set(`fusion:users:fake-last-fm-user:lastfm:${TimeRange.long}`, JSON.stringify([{ id: 2 }]));
    }),

    mockDescompressMusics: vi.fn((data) => data),
    mockFilterByLastFmHistory: vi.fn(() => trackDataSpotifyReturnValue),
}));

vi.mock("../../utils/fusionUtils", async (importOriginal) => {
    const actual = await importOriginal<any>()

    return {
        ...actual, // 👈 mantém tudo real por padrão
        throwIfCanceledFusion: mockThrowIfCanceledFusion,
        fetchTracksNotInCacheLovedTracks: mockFetchTracksNotInCacheLovedTracks,
        fetchSingleRangeNotInCache: mockFetchSingleRangeNotInCache,
        fetchLastFmNotInCache: mockFetchLastFmNotInCache,
        descompressMusics: mockDescompressMusics,
        filterByLastFmHistory: mockFilterByLastFmHistory,
    }
})
describe("Worker Fusion", () => {

    let worker: Worker
    let queue: Queue
    let queueEvents: QueueEvents
    beforeAll(async () => {

        queue = new Queue(
            "rediscover-fusion",
            {
                connection: redis
            }
        );
        queueEvents = new QueueEvents(
            "rediscover-fusion",
            {
                connection: redis
            }
        )
        worker = rediscoverFusionWorker
        await worker.waitUntilReady();

        worker.on("completed", (job) => {
            console.log("COMPLETED:", job.id)
        })
    })

    beforeEach(async () => {
        vi.clearAllMocks();
        await redis.flushdb();
    });

    afterAll(async () => {
        await worker.close()
        await queue.close()
        await queueEvents.close()
        vi.restoreAllMocks()
    })

    it("Should process a job and return successfully a log 'Job successful'", async () => {

        const jobData = {
            params: {
                access_token: "fake-access-token",
                spotifyId: "fake-spotify-id",
                compare: {
                    firstCompare: TimeRange.long,
                    secondCompare: TimeRange.loved_tracks
                },
                lastFmUser: "fake-last-fm-user"
            }
        }
        const job = await queue.add("rediscover-fusion", jobData)
        const result = await job.waitUntilFinished(queueEvents);
        expect(result).toEqual(trackDataSpotifyReturnValue);
    })


    it("Should cancel job during processing - worker must abort", async () => {

        const { JobCanceledError } = await import("../../utils/spotifyUtils.js")

        mockFetchTracksNotInCacheLovedTracks.mockImplementationOnce(
            async (signal, access_token, spotifyId, job, abortControllers) => {

                return new Promise((resolve, reject) => {
                    const timeoutID = setTimeout(async () => {
                        await redis.set(`fusion:users:fake-spotify-id:${TimeRange.loved_tracks}`, JSON.stringify([
                            { id: 1 }
                        ]))
                        resolve(undefined)
                    }, 5000)

                    signal.addEventListener("abort", () => {
                        clearTimeout(timeoutID)
                        reject(new JobCanceledError)
                    })
                })
            }
        )


        const jobData = {
            params: {
                access_token: "fake-access-token",
                spotifyId: "fake-spotify-id",
                compare: {
                    firstCompare: TimeRange.long,
                    secondCompare: TimeRange.loved_tracks
                },
                lastFmUser: "fake-last-fm-user"
            }
        }

        const job = await queue.add("rediscover-fusion", jobData)
        await new Promise((resolve) => setTimeout(resolve, 150))

        rediscoverFusionQueueEvents.emit("removed", { jobId: job.id!, prev: "" }, "0");
        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow(/JOB_CANCELED_OR_DELETED/)
    })

    it("8.5 Should fail the worker (e.g. invalid API key) - job must go to failed state", async () => {
        // 1. Simulamos o erro: O serviço vai rejeitar a promessa com um erro de API
        const apiError = new Error("Invalid API key or Unauthorized");
        mockFetchTracksNotInCacheLovedTracks.mockRejectedValueOnce(apiError);

        const jobData = {
            params: {
                access_token: "fake-access-token",
                spotifyId: "fake-spotify-id",
                compare: {
                    firstCompare: TimeRange.long,
                    secondCompare: TimeRange.loved_tracks
                },
                lastFmUser: "fake-last-fm-user"
            }
        }

        const job = await queue.add("rediscover-fusion", jobData);

        await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow("Invalid API key or Unauthorized");

        const state = await job.getState();
        expect(state).toBe("failed");

        const updatedJob = await queue.getJob(job.id!)
        expect(updatedJob!.failedReason).toContain("Invalid API key or Unauthorized")
    });
})