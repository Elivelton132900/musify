import { Job } from "bullmq"
import { RediscoverLovedTracksBody } from "../models/last-fm.model"
import { rediscoverLastFmQueue } from "../queues/rediscoverLastfm.queue"
import { Request, Response, NextFunction } from "express"

const isJsonEqual = (
    urlBody: RediscoverLovedTracksBody,
    jobJson: RediscoverLovedTracksBody,
): boolean => {

    if (!urlBody || !jobJson) return false

    // Extracted replacer function to keep things clean
    const replacer = (key: string, value: any) => {
        if (value === null || value === undefined) return value
        if (typeof value !== "object") {
            return String(value)
        }
        return value
    }

    try {
        const urlQueryStringValues = JSON.parse(JSON.stringify(urlBody, replacer))
        const jobJsonStringValues = JSON.parse(JSON.stringify(jobJson, replacer))

        return (
            JSON.stringify(urlQueryStringValues, Object.keys(urlQueryStringValues).sort()) ===
            JSON.stringify(jobJsonStringValues, Object.keys(jobJsonStringValues).sort())
        )
    } catch (err) {
        console.error("Error parsing JSON during comparison:", err)
        return false
    }
}

const jobAlreadyRunningOrcompleted = (
    jobs: Job[],
    urlQuerys: RediscoverLovedTracksBody,
): boolean => {
    for (let i = 0; i < jobs.length; i++) {
        const jobParams = jobs[i]?.data?.params || jobs[i]?.data
        
        if (isJsonEqual(urlQuerys, jobParams)) {
            return true
        }
    }
    return false
}

export async function jobWithSameUrlExists(req: Request, res: Response, next: NextFunction) {
    try {
        const urlBody = req.body as unknown as RediscoverLovedTracksBody
       
        const jobsActiveAndCompleted = await rediscoverLastFmQueue.getJobs(
            ["active", "completed", "waiting"],
            0,
            -1,
        )

        const sameUrl = jobAlreadyRunningOrcompleted(jobsActiveAndCompleted, urlBody)

        if (sameUrl) {
            return res.status(409).json({
                error: "Already exists a job with the same parameters",
            })
        }

        next()
    } catch (e: unknown) {
        if (e instanceof Error) {
            return next(e)
        }

        return next(new Error("Unknown error"))
    }
}
