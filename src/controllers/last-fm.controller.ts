import { Request, Response } from "express"
import { ObjectId, RediscoverLovedTracksBody } from "../models/last-fm.model"
import { rediscoverLastFmQueue } from "../queues/rediscoverLastfm.queue"
import { redis } from "../infra/redis"
import { addJobToQueue as originalAddJobToQueue } from "../utils/lastFmUtils"
import dayjs from "dayjs"

export class LastFmController {

    static addJobToQueue = originalAddJobToQueue

    static async rediscoverLovedTracks(req: Request, res: Response) {
        try {
            const query = req.body as unknown as RediscoverLovedTracksBody
            const candidateStart = dayjs(req.body.candidateFrom).utc()
            const candidateEnd = dayjs(req.body.candidateTo).utc()


            const fetchInDays = candidateEnd.diff(candidateStart, "day")
            const {
                distinct,
                candidateFrom,
                candidateTo,
                comparisonFrom,
                comparisonTo,
                lastFmUser,
            } = query


            const job = await LastFmController.addJobToQueue(
                candidateFrom,
                candidateTo,
                comparisonFrom,
                comparisonTo,
                lastFmUser,
                fetchInDays,
                distinct
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


        const isDeleted = await redis.get(`rediscover:delete:${jobId}`)
        const isCancelled = await redis.get(`rediscover:cancel:lastfm:${jobId}`)

        if (isDeleted || isCancelled) {
            res.json({
                state: "cancelled",
                result: null,
            })
            return
        }
        
        const job = await rediscoverLastFmQueue.getJob(jobId)
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

        const job = await rediscoverLastFmQueue.getJob(jobId as string)

        if (!job) {
            res.status(404).json({ error: "Job not found." })
            return
        }

        await redis.set(`rediscover:cancel:lastfm:${jobId}`, "1", "EX", 60 * 60 * 24)
        // salvando cancel para a fila progredir para o proximo. deletar o job {jobId}
        // se não ter como salvar a data que a musica foi escutada e cruzar dados para otimização, pular paginas
        // onde já tem dados salvos
        res.json({ status: `Job ${jobId} marked as cancelled` })
    }

    // se for interrompido a requisicao no meio do job post queue mudar para rediscover:cancel e deletar job
    static async deleteRediscover(req: Request, res: Response) {
        const { jobId } = req.params

        const job = await rediscoverLastFmQueue.getJob(jobId as string)
        if (job) {
            await redis.set(`rediscover:delete:${jobId}`, "1", "EX", 3600)

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
            error: `Job ${jobId} not deleted because was not founded.`,
        })
    }

    static async getJobs(req: Request, res: Response) {
        const jobs = await rediscoverLastFmQueue.getJobs(["wait", "active"], 0, -1)
        res.status(200).json({
            jobs,
            timeStamp: new Date().toISOString(),
        })
    }
}
