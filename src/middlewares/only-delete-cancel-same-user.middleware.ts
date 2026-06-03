import { NextFunction, Request, Response } from "express"
import "dotenv/config"
import { rediscoverFusionQueue } from "../queues/rediscoverFusion.queue"
import { BullMqJobInterface } from "../models/fusion.model"

export const restrictSameUser = async (req: Request, res: Response, next: NextFunction) => {

    const { lastFmUser, spotifyId, jobId } = req.params

    const job = await rediscoverFusionQueue.getJob(jobId)
    if (!job) {
        return res.status(404).json({
            error: "Job not found"
        })
    }

    const jobData: BullMqJobInterface = job?.data

    const { spotifyId: spotifyIdJob, lastFmUser: lastFmUserJob } = jobData.params

    console.log(lastFmUser, lastFmUserJob, spotifyId, spotifyIdJob)

    if (lastFmUser !== lastFmUserJob || spotifyId !== spotifyIdJob) {
        return res.status(401).json({
            error: "You can not delete or cancel a job from a different person"
        })
    }


    return next()
}