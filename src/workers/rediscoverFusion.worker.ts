import { Worker } from "bullmq"
import { JobCanceledError } from "../utils/spotifyUtils"
import {
    descompressMusics,
    fetchLastFmNotInCache,
    fetchSingleRangeNotInCache,
    fetchTracksNotInCacheLovedTracks,
    filterByLastFmHistory,
    throwIfCanceledFusion,
} from "../utils/fusionUtils"
import { TimeRange, TrackDataSpotify } from "../models/spotify.model"
import { FusionBody, LastFmHistory } from "../models/fusion.model"
import { redis } from "../infra/redis"
import { rediscoverFusionQueueEvents } from "../queues/rediscoverFusion.queue"

const abortControllers = new Map<string, AbortController>()

export const rediscoverFusionWorker = new Worker(
    "rediscover-fusion",
    async (job) => {
        if (job.name !== "rediscover-fusion") return

        console.log("entrei no worker, job id: ", job.id)
        const controller = new AbortController()
        abortControllers.set(job.id!, controller)
        const { signal } = controller

        const { params } = job.data as { params: FusionBody }
        const { access_token, spotifyId, compare, lastFmUser } = params
        console.log("COMPAREEEEEEEEEE: ", compare)
        await throwIfCanceledFusion(job, signal, spotifyId, compare)
        if (signal.aborted) throw new JobCanceledError()

        console.log("ACCESS TOKEEEEEEEEEEEEEEEEEEEEEEEN ", access_token)

        if (compare.firstCompare === TimeRange.loved_tracks) {
            throw new Error("Fist compare can not be Loved Tracks")
        }

        if (compare.secondCompare !== TimeRange.loved_tracks) {
            throw new Error("Second compare must be Loved Track")
        }

        const lovedTracks = await redis.getBuffer(
            `fusion:users:${spotifyId}:${TimeRange.loved_tracks}`,
        )
        const firstCompare = await redis.getBuffer(
            `fusion:users:${spotifyId}:${compare.firstCompare}`,
        )

        const lastFmCompare = await redis.getBuffer(
            `fusion:users:${lastFmUser}:lastfm:${compare.firstCompare}`,
        )

        if (!lovedTracks) {
            await fetchTracksNotInCacheLovedTracks(
                signal,
                access_token,
                spotifyId,
                job,
                abortControllers,
            )
        }
        console.log("\n\n\n\n\n FIRST CCOMPAREEEEE \n\n\n\n ", lastFmCompare)

        if (!firstCompare) {
            await fetchSingleRangeNotInCache(
                signal,
                access_token,
                spotifyId,
                compare,
                job,
                abortControllers,
            )
        }

        if (!lastFmCompare) {
            await fetchLastFmNotInCache(
                compare,
                signal,
                lastFmUser,
                job,
                abortControllers,
            )
        }

        const redisCompressedLastFm = await redis.getBuffer(
            `fusion:users:${lastFmUser}:lastfm:${compare.firstCompare}`,
        )
        const redisCompressedSpotify = await redis.getBuffer(
            `fusion:users:${spotifyId}:${TimeRange.loved_tracks}`,
        )

        if (redisCompressedLastFm === null || redisCompressedSpotify === null) {
            throw new Error("Cache not found")
        }

        const descompressedLastFm = descompressMusics<LastFmHistory[]>(
            redisCompressedLastFm,
        )
        const descompressedSpotify = descompressMusics<TrackDataSpotify[]>(
            redisCompressedSpotify,
        )

        const finalResult = filterByLastFmHistory(
            descompressedSpotify,
            descompressedLastFm,
        )

        return finalResult
    },
    {
        connection: redis,
        concurrency: 1,
        maxStalledCount: 50,
        lockDuration: 120000,
    },
)

rediscoverFusionWorker.on("ready", () => {
    console.log("fusion worker: estou pronto")
})

rediscoverFusionWorker.on("failed", async (job, err) => {
    if (!job) return

    console.error("Job falhou ", job?.id, err.message)

    // se foi cancelado, remove
    if (err.message.includes("DELETED")) {
        try {
            await job.remove()
            await redis.del(`rediscover:delete:spotify:${job.id}`)
            console.log(`Job ${job.id} removed after cancel`)
        } catch (removeError) {
            console.error(`Error removing job ${job.id}: `, removeError)
        }
    }
})

rediscoverFusionQueueEvents.on("removed", (job) => {
    const controller = abortControllers.get(job.jobId)
    if (controller) {
        console.log("Job removido, abortando execução: ", job.jobId)
        controller.abort()
        abortControllers.delete(job.jobId)
    }
})
