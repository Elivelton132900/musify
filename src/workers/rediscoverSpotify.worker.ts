import { RediscoverJobData } from "./../models/spotify.model"
import { Job, Worker } from "bullmq"
import { SpotifyService } from "../services/spotify.service"
import { JobCanceledError, throwIfCanceled } from "../utils/spotifyUtils"
import { redis } from "../infra/redis"
import { rediscoverSpotifyQueueEvents } from "../queues/rediscoverSpotify.queue"

const abortControllers = new Map<string, AbortController>()

export const rediscoverSpotifyWorker = new Worker(
    "rediscover-loved-tracks-spotify",
    async (job: Job<RediscoverJobData>) => {
        const { access_token, spotifyId, compare } = job.data

        if (job.name !== "rediscover-loved-tracks-spotify") return

        const controller = new AbortController()
        abortControllers.set(job.id!, controller)

        const { signal } = controller
        await throwIfCanceled(job, signal)

        try {
            const spotifyService = new SpotifyService()

            if (signal.aborted) return
            const noMoreListenedMusics = await spotifyService.syncAndCompare(
                access_token,
                spotifyId,
                compare,
                job,
                signal
            )
            if (signal.aborted) return

            if (
                !noMoreListenedMusics ||
                (Array.isArray(noMoreListenedMusics) &&
                    noMoreListenedMusics.length === 0)
            ) {
                console.warn("Resultado vazio ou inválido, não salvando cache")
                return {
                    error: "User does not returned any value",
                }
            }

            if (signal.aborted) throw new JobCanceledError()
            console.log("Job successful")
            return noMoreListenedMusics
        } catch (e: any) {
            if (e instanceof JobCanceledError) {
                console.log("Job canceled by ", job.id)
                throw e
            }
            console.log("Error: ", e)
            throw e
        } finally {
            abortControllers.delete(job.id!) // ← ADICIONE ISSO
        }
    },
    {
        connection: redis,
        concurrency: 1,
        maxStalledCount: 50,
        lockDuration: 120000,
        removeOnFail: { age: 3600 },
    },
)

rediscoverSpotifyWorker.on("ready", () => {
    console.log("spotify: estou pronto")
})

rediscoverSpotifyWorker.on("failed", async (job, err) => {
    if (!job) return

    console.error("Job falhou ", job?.id, err.message)

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

rediscoverSpotifyQueueEvents.on("removed", (job) => {
    const controller = abortControllers.get(job.jobId)
    if (controller) {
        console.log("Job removido, abortando execução: ", job.jobId)
        controller.abort()
        abortControllers.delete(job.jobId)
    }
})
