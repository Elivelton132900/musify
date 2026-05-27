import { vi } from 'vitest'

const jobsStore = new Map<string, any>()

const mockQueue = class {
    add = vi.fn().mockImplementation(async (name: string, data: any) => {
        const jobId = `job-${Date.now()}-${Math.random()}`
        const formattedData = {
            params: {
                spotifyId: data.spotifyId || data.params?.spotifyId || "fake-spotify-user-id",
                compare: data.compare || data.params?.compare || {
                    firstCompare: "long_term",
                    secondCompare: "short_term"
                }
            },
            access_token: data.access_token || "fake-access-token-123",
            spotifyId: data.spotifyId || "fake-spotify-user-id",
            compare: data.compare || {
                firstCompare: "long_term",
                secondCompare: "short_term"
            }
        }
        const job = {
            id: jobId,
            name: name,
            data: formattedData,
            timestamp: Date.now(),
            attempts: 0,
            delay: 0,
            getState: vi.fn().mockResolvedValue("waiting"),
            remove: vi.fn().mockImplementation(async () => {
                jobsStore.delete(jobId)
                return undefined
            }),
            returnvalue: null
        }
        jobsStore.set(jobId, job)
        return job
    })

    getJob = vi.fn().mockImplementation(async (jobId: string) => {
        const job = jobsStore.get(jobId) || null
        if (job) {
            return {
                ...job,
                remove: job.remove
            }
        }
        return null
    })

    getJobs = vi.fn().mockImplementation(async () => {
        return Array.from(jobsStore.values())
    })
}

const mockQueueEvents = class {
    on = vi.fn().mockReturnThis()
    close = vi.fn().mockResolvedValue(undefined)
}

const mockWorker = class {
    on = vi.fn()
    close = vi.fn().mockResolvedValue(undefined)
}

const mockQueueScheduler = class {
    close = vi.fn().mockResolvedValue(undefined)
}

export default {
    Queue: mockQueue,
    QueueEvents: mockQueueEvents,
    Worker: mockWorker,
    QueueScheduler: mockQueueScheduler
}