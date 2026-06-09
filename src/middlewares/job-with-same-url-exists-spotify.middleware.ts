import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"
import { rediscoverSpotifyQueue } from "../queues/rediscoverSpotify.queue"
import { SpotifyJWTPayload } from "../models/spotify.auth.model"

const extractJobData = (job: any) => {
    if (job.data.params) {
        return {
            spotifyId: job.data.params.spotifyId,
            firstCompare: job.data.params.compare?.firstCompare,
            secondCompare: job.data.params.compare?.secondCompare
        }
    }
    return {
        spotifyId: job.data.spotifyId,
        firstCompare: job.data.compare?.firstCompare,
        secondCompare: job.data.compare?.secondCompare
    }
}

export const jobWithSameUrlExists = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const token = req.cookies.spotify_token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as SpotifyJWTPayload
        const { userId } = decoded
        const rangeToCompare = req.body.range

        const allJobs = await rediscoverSpotifyQueue.getJobs(
            ["active", "waiting", "completed"],
            0,
            -1,
        )

        const jobExists = allJobs.some((job) => {
            const { spotifyId: jobUserId, firstCompare, secondCompare } = extractJobData(job)

            if (!firstCompare || !secondCompare) {
                return false
            }

            const first = firstCompare.replace("_term", "")
            const second = secondCompare.replace("_term", "").replace("_tracks", "")
            const jobRangeKey = `${first}_${second}`

            const isMatch = jobUserId === userId && jobRangeKey === rangeToCompare

            return isMatch
        })

        if (jobExists) {
            return res.status(409).json({
                error: "Already exists a job with the same parameters"
            })
        }

        return next()
    } catch (error) {
        console.error("Erro:", error)
        return next(error instanceof Error ? error : new Error("Unknown Error"))
    }
}