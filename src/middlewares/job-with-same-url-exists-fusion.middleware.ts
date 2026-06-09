import { Request, Response } from "express"
import { FusionBody } from "../models/fusion.model"
import { rediscoverFusionQueue } from "../queues/rediscoverFusion.queue"
import { NextFunction } from "express-serve-static-core"
import { SpotifyJWTPayload } from "../models/spotify.auth.model"
import jwt from "jsonwebtoken"
type FusionBodyWithoutToken = Omit<FusionBody, "access_token">

export const jobWithSameUrlExists = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const body = req.body as unknown as FusionBody
        const { access_token: _, lastFmUser, compare } = body

        const token = req.cookies.spotify_token

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET!,
        ) as SpotifyJWTPayload

        const { spotifyId } = decoded

        const newRequest = { spotifyId, lastFmUser, compare }
        const jobsInQueue = await rediscoverFusionQueue.getJobs(
            ["active", "completed", "waiting"],
            0,
            -1,
        )

        const jobsData: FusionBodyWithoutToken[] = []

        jobsInQueue.map((job) => {
            const spotifyId = job.data.params.spotifyId
            const compare = job.data.params.compare
            const lastFmUser = job.data.params.lastFmUser

            const obj = { spotifyId, lastFmUser, compare }
            jobsData.push(obj)
        })

        for (let i = 0; i < jobsData.length; i++) {
            const isEqual =
                JSON.stringify(jobsData[i]) === JSON.stringify(newRequest)

            if (isEqual) {
                return res.status(409).json({
                    error: "Already exists a job with the same parameters",
                })
            }
        }
        next()
    } catch (e: unknown) {
        if (e instanceof Error) {
            return next(e)
        }

        return next(new Error("unknown error"))
    }
}
