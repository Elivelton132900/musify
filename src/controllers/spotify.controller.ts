import { rediscoverSpotifyQueue } from "../queues/rediscoverSpotify.queue"
import { SpotifyCookies, SpotifyJWTPayload } from "../models/spotify.auth.model"
import { Request, Response } from "express"
import { PossibleRanges, TimeRange } from "../models/spotify.model"
import { redis } from "../infra/redis"
import { addJobToQueue as originalAddJobToQueue } from "../utils/spotifyUtils"

export interface SpotifyRequest extends Request {
    cookies: SpotifyCookies
    spotifyUser?: SpotifyJWTPayload
}

interface Track {
    userId?: string
    trackId?: string
    name?: string
    artist?: string
    [key: string]: unknown
}

interface JobResultWithTracks {
    tracks?: Track[]
    [key: string]: unknown
}


export class SpotifyController {
    static addJobToQueue = originalAddJobToQueue
    static async syncAndCompareTimeRange(req: SpotifyRequest, res: Response) {

        try {

            const access_token = req.spotifyUser?.access_token || ""
            const spotifyId = req.spotifyUser?.spotifyId || ""

            const comparationRange: string = req.body.range
            const timeRanges: string =
                PossibleRanges[comparationRange as keyof typeof PossibleRanges]
            const rangesToCompare = timeRanges.split("-")

            const firstRange = TimeRange[rangesToCompare[0] as keyof typeof TimeRange]
            const secondRange = TimeRange[rangesToCompare[1] as keyof typeof TimeRange]

            const compare = { firstCompare: firstRange, secondCompare: secondRange }
            const job = await SpotifyController.addJobToQueue(access_token, spotifyId, compare)

            res.status(202).json({
                jobId: job.id,
                status: "processing",
            })
        } catch (err: any) {
            if (err.name === "CanceledError" || err.code === "ERR_CANCELED") {
                console.log(" Requisição cancelada")
                return
            }

            console.error(err)
            res.status(500).json({ error: "Internal server error" })
        }
    }

    static async getJob(req: SpotifyRequest, res: Response): Promise<void> {
        const { jobId } = req.params as { jobId: string }

        const job = await rediscoverSpotifyQueue.getJob(jobId)

        if (!job) {
            res.status(404).json({ error: "Job not found" })
            return
        }

        const spotifyUser = req.spotifyUser
        // ✅ Verifica se o job pertence ao usuário autenticado
        if (spotifyUser && job.data?.spotifyId !== spotifyUser.spotifyId) {
            res.status(403).json({
                error: "Access denied. This job belongs to another user."
            })
            return
        }

        const state = await job.getState()
        let result: unknown = job.returnvalue ?? null
        let resultLength: number | null = null

        // ✅ Filtra apenas as músicas do usuário atual (se aplicável)
        if (spotifyUser && result) {
            if (Array.isArray(result)) {
                // Se result é um array de tracks
                const tracks = result as Track[]
                const filteredTracks = tracks.filter(
                    (track: Track) => track.userId === spotifyUser.spotifyId
                )
                result = filteredTracks
                resultLength = filteredTracks.length
            } else if (typeof result === "object" && result !== null) {
                // Se result é um objeto com propriedade tracks
                const resultObj = result as JobResultWithTracks
                if (Array.isArray(resultObj.tracks)) {
                    const filteredTracks = resultObj.tracks.filter(
                        (track: Track) => track.userId === spotifyUser.spotifyId
                    )
                    result = {
                        ...resultObj,
                        tracks: filteredTracks
                    }
                    resultLength = filteredTracks.length
                }
            }
        } else if (!spotifyUser && result) {
            // Se não tem usuário autenticado, não filtra
            if (Array.isArray(result)) {
                resultLength = result.length
            } else if (typeof result === "object" && result !== null) {
                const resultObj = result as JobResultWithTracks
                if (Array.isArray(resultObj.tracks)) {
                    resultLength = resultObj.tracks.length
                }
            }
        }

        res.json({
            state,
            result,
            length: resultLength,
        })
    }

    static async cancelRediscover(req: Request, res: Response) {
        const { jobId } = req.params
        const job = await rediscoverSpotifyQueue.getJob(jobId as string)

        if (!job) {
            res.status(404).json({
                error: "Job not found",
            })
            return
        }

        await redis.set(`rediscover:cancel:spotify:${jobId}`, "1", "EX", 60 * 60 * 24)

        res.json({
            status: `Job ${jobId} marked as cancelled`,
        })
    }

    static async deleteRediscover(req: Request, res: Response) {
        const { jobId } = req.params

        const job = await rediscoverSpotifyQueue.getJob(jobId as string)

        if (job) {
            await redis.set(`rediscover:delete:spotify:${jobId}`, "1", "EX", 3600)

            await redis.del(`spotify:users:${job.data.params.spotifyId}:${job.data.params.compare.firstCompare}`)
            await redis.del(`spotify:users:${job.data.params.spotifyId}:${job.data.params.compare.secondCompare}`)
            const state = await job.getState()

            if (state !== "active") {
                await job.remove()
            }

            res.status(200).json({
                status: `Job ${jobId} deleted and marked as cancelled`,
            })
            return
        }

        res.status(404).json({
            error: `Job ${jobId} not deleted because was not founded`,
        })
    }

    static async getJobs(req: Request, res: Response) {
        const jobs = await rediscoverSpotifyQueue.getJobs(["wait", "active"], 0, -1)
        res.status(200).json({
            jobs,
            timeStamp: new Date().toISOString(),
        })
    }
}
