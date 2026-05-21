import { Response, Request } from "express"
import { FusionBody } from "../models/fusion.model"
import { rediscoverFusionQueue } from "../queues/rediscoverFusion.queue"
import { DeleteRoute, ObjectId } from "../models/last-fm.model"
import { redis } from "../infra/redis"
import jwt from "jsonwebtoken"
import { SpotifyJWTPayload } from "../models/spotify.auth.model"

export class FusionController {
    static async rediscoverFusion(req: Request, res: Response) {
        try {
            const body = req.body as unknown as FusionBody
            const { compare, lastFmUser } = body

            const spotifyCookies = req.cookies.spotify_token

            if (!spotifyCookies) {
                throw new Error("Not spotify cookies found")
            }

            const decoded = jwt.decode(spotifyCookies) as SpotifyJWTPayload

            const access_token: string = decoded?.access_token
            const spotifyId: string = decoded?.spotifyId

            const params = {
                access_token,
                spotifyId,
                compare,
                lastFmUser,
            } as FusionBody

            const job = await rediscoverFusionQueue.add(
                "rediscover-fusion",
                {
                    params,
                },
                {
                    removeOnComplete: {
                        age: 60 * 60 * 24 * 10,
                    },
                    removeOnFail: false,
                },
            )

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

    static async getJob(req: Request, res: Response) {
        const param = req.params as ObjectId
        const { jobId } = param

        const job = await rediscoverFusionQueue.getJob(jobId)
        if (!job) {
            res.status(404).json({ error: "Job not found" })
            return
        }

        const state = await job.getState()

        res.json({
            state,
            result: job.returnvalue ?? null,
        })
    }

    static async cancelRediscover(req: Request, res: Response) {
        const { jobId } = req.params

        if (!jobId) {
            res.status(404).json({ error: "Job ID is required" })
            return
        }

        const job = await rediscoverFusionQueue.getJob(jobId as string)

        if (!job) {
            res.status(404).json({ error: "Job not found." })
            return
        }

        await redis.set(
            `rediscover:cancel:fusion:${jobId}`,
            "1",
            "EX",
            60 * 60 * 24,
        )
        // salvando cancel para a fila progredir para o proximo. deletar o job {jobId}
        // se não ter como salvar a data que a musica foi escutada e cruzar dados para otimização, pular paginas
        // onde já tem dados salvos
        res.json({ status: `Job ${jobId} marked as cancelled` })
    }

    // se for interrompido a requisicao no meio do job post queue mudar para rediscover:cancel e deletar job
    static async deleteRediscover(req: Request, res: Response) {
        const { jobId, spotifyId, lastFmUser } = req.params as DeleteRoute

        const job = await rediscoverFusionQueue.getJob(jobId as string)
        console.log("VOU LOGAAR JOB  ", job?.data)
        if (job) {
            await redis.set(`rediscover:delete:fusion:${jobId}`, "1", "EX", 300)
            const state = await job.getState()

            if (state !== "active") {
                await job.remove()
            }

            const keysSpotify = await redis.keys(`fusion:users:${spotifyId}:*`)
            const keysLastFM = await redis.keys(`fusion:users:${lastFmUser}:*`)

            if (keysSpotify.length > 0) {
                await redis.del(...keysSpotify)
            }

            if (keysLastFM.length > 0) {
                await redis.del(...keysLastFM)
            }

            res.status(200).json({
                status: `Job ${jobId} deleted and marked as cancelled`,
            })
            return
        }

        if (!job) {
            res.status(404).json({
                error: `Job ${jobId} not deleted because was not founded.`,
            })
        }
    }
    static async getJobs(req: Request, res: Response) {
        const jobs = await rediscoverFusionQueue.getJobs(
            ["wait", "completed", "active"],
            0,
            -1,
        )
        res.status(200).json({
            jobs,
            timeStamp: new Date().toISOString(),
        })
    }
}
