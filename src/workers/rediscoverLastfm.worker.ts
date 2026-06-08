import "dotenv/config"

import { Job, Worker } from "bullmq"
import { redis } from "../infra/redis"
import { LastFmService } from "../services/last-fm.service"
import { JobCanceledError, throwIfCanceled } from "../utils/lastFmUtils"
import { RediscoverLovedTracksBody } from "../models/last-fm.model"
import { rediscoverLastFmQueueEvents } from "../queues/rediscoverLastfm.queue"

const service = new LastFmService()

export const lastFmWorkerProcessor = async (job: Job<RediscoverLovedTracksBody>) => {
    if (job.name !== "rediscover-loved-tracks-last-fm") return
    console.log("service =", service)
    console.log(
        "typeof rediscoverLovedTracks =",
        typeof service.rediscoverLovedTracks
    )
    console.log("params ", job.data)


    const { lastFmUser } = job.data

    const controller = new AbortController()
    abortControllers.set(job.id!, controller)
    const { signal } = controller

    await throwIfCanceled(job!, signal)

    try {
        const result = await service.rediscoverLovedTracks(lastFmUser, job.data, signal, job)
        console.log("RESULT =", result)
        console.log("IS ARRAY =", Array.isArray(result))
        console.log("LENGTH =", result?.length)
        if (signal.aborted) return
        if (!result || (Array.isArray(result) && result.length === 0)) {
            console.warn("Resultado vazio ou inválido, não salvando cache")
            return {
                error: "User does not have scrobble or user does not exist",
            }
        }

        if (signal.aborted) throw new JobCanceledError()

        return result
    } catch (e: any) {
        if (e instanceof JobCanceledError) {
            console.log("Job canceled by ", job.id)
            throw e
        }
        console.log("Error: ", e)
        throw e
    } finally {
        abortControllers.delete(job.id!)
    }
}

const abortControllers = new Map<string, AbortController>()

export const rediscoverLastFmWorker = new Worker(
    "rediscover-loved-tracks-last-fm",
    lastFmWorkerProcessor,
    {
        connection: redis,
        concurrency: 1,
        maxStalledCount: 50,
        lockDuration: 120000,
    },
)

rediscoverLastFmWorker.on("ready", () => {
    console.log("last fm worker: estou pronto ")
})

rediscoverLastFmWorker.on("failed", async (job, err) => {
    if (!job) return
    console.error("Job falhou", job?.id, err.message)

    if (err.message.includes("DELETED")) {
        try {
            await job.remove()
            await redis.del(`rediscover:delete:${job.id}`)
            console.log(`Job ${job.id} removed after cancel`)
        } catch (removeError) {
            console.error(`Error removing job ${job.id}: `, removeError)
        }
    }
})

rediscoverLastFmQueueEvents.on("removed", ({ jobId }) => {
    const controller = abortControllers.get(jobId)
    if (controller) {
        console.log("Job removido, abortando execução: ", jobId)
        controller.abort()
        abortControllers.delete(jobId)
    }
})
