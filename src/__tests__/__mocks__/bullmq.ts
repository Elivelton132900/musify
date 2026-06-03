// import { vi } from 'vitest'

// const jobsStore = new Map<string, any>()

// const mockQueue = class {
//     add = vi.fn().mockImplementation(async (name: string, data: any, opts: any) => {
//         const jobId = data.jobIdMocked || `job-${Date.now()}-${Math.random()}`
//         const delay = opts?.delay || 0
//         const formattedData = {
//             params: {
//                 spotifyId: data.spotifyId || data.params?.spotifyId || "fake-spotify-user-id",
//                 compare: data.compare || data.params?.compare || {
//                     firstCompare: "long_term",
//                     secondCompare: "short_term"
//                 }
//             },
//             access_token: data.access_token || "fake-access-token-123",
//             spotifyId: data.spotifyId || "fake-spotify-user-id",
//             compare: data.compare || {
//                 firstCompare: "long_term",
//                 secondCompare: "short_term"
//             }
//         }

//         let currentState = delay > 0 ? "delayed" : "waiting"
//         let isCancelled = false
//         let isCompleted = false
//         let progress = 0
//         let processingTimeout: NodeJS.Timeout | null = null

//         const job = {
//             id: jobId,
//             name: name,
//             data: formattedData,
//             timestamp: Date.now(),
//             attempts: 0,
//             delay: 0,
//             getState: vi.fn().mockImplementation(async () => {
//                 if (isCancelled) return 'failed'
//                 if (isCompleted) return 'completed'
//                 return currentState
//             }),

//             updateProgress: vi.fn().mockImplementation(async (value: number) => {
//                 progress = value
//             }),

//             remove: vi.fn().mockImplementation(async () => {
//                 if (processingTimeout) {
//                     clearTimeout(processingTimeout)
//                 }
//                 jobsStore.delete(jobId)
//                 return undefined
//             }),

//             returnvalue: null
//         }
//         jobsStore.set(jobId, job)
//         if (delay >= 0) {
//             processingTimeout = setTimeout(async () => {
//                 const storedJob = jobsStore.get(jobId)
//                 if (storedJob && !storedJob.cancelled) {
//                     // Muda para active
//                     currentState = 'active'

//                     console.log(`[Mock BullMQ] Job ${jobId} is now ACTIVE`)

//                     // Simula processamento (10 passos, 50ms cada = 500ms total)
//                     for (let i = 1; i <= 10; i++) {
//                         if (storedJob.cancelled) {
//                             currentState = 'failed'
//                             console.log(`[Mock BullMQ] Job ${jobId} was CANCELLED during processing`)
//                             break
//                         }
//                         progress = i * 10
//                         await new Promise(resolve => setTimeout(resolve, 50))
//                     }

//                     // Se não foi cancelado, completa
//                     if (!storedJob.cancelled) {
//                         currentState = 'completed'
//                         isCompleted = true
//                         progress = 100
//                         console.log(`[Mock BullMQ] Job ${jobId} COMPLETED successfully`)
//                     }
//                 } else if (storedJob?.cancelled) {
//                     console.log(`[Mock BullMQ] Job ${jobId} was CANCELLED before processing`)
//                 }
//             }, delay)
//         }

//         return job
//     })



//     getJob = vi.fn().mockImplementation(async (jobId: string) => {
//         const job = jobsStore.get(jobId) || null
//         if (job) {
//             return {
//                 ...job,
//                 getState: job.getState,
//                 updateProgress: job.updateProgress,
//                 remove: job.remove
//             }
//         }
//         return null
//     })

//     getJobs = vi.fn().mockImplementation(async () => {
//         return Array.from(jobsStore.values())
//     })
// }

// const mockQueueEvents = class {
//     on = vi.fn().mockReturnThis()
//     close = vi.fn().mockResolvedValue(undefined)
// }

// const mockWorker = class {
//     on = vi.fn()
//     close = vi.fn().mockResolvedValue(undefined)
// }

// const mockQueueScheduler = class {
//     close = vi.fn().mockResolvedValue(undefined)
// }

// export default {
//     Queue: mockQueue,
//     QueueEvents: mockQueueEvents,
//     Worker: mockWorker,
//     QueueScheduler: mockQueueScheduler
// }




// ====================================================

import { vi } from 'vitest'
import { TrackDataSpotify } from '../../models/spotify.model'
import { trackDataSpotifyReturnValue } from '../example-response-fusion'
const jobsStore = new Map<string, any>()
let nextId = 1

const mockQueue = class {
    constructor(name: string) {
        this.name = name
    }

    name: string

    add = vi.fn(async (name: string, data: any) => {
        const jobId = String(nextId++)

        let state = "waiting"

        const job = {
            id: jobId,
            name,
            data,
            returnvalue: null as TrackDataSpotify[] | null,
            getState: vi.fn(async () => state),

            remove: vi.fn(async () => {
                jobsStore.delete(jobId)
            }),
        }
        jobsStore.set(jobId, job)

        setTimeout(() => {
            state = "active"
        }, 100)

        setTimeout(() => {
            state = "completed"
            job.returnvalue = trackDataSpotifyReturnValue
        }, 500)

        return job
    })

    getJob = vi.fn().mockImplementation(async (jobId: string) => {
        const stored = jobsStore.get(jobId)
        if (!stored) return null

        return {
            id: stored.id,
            name: stored.name,
            data: stored.data,
            timestamp: stored.timestamp,
            delay: stored.delay,
            getState: stored.getState,
            updateProgress: stored.updateProgress,
            remove: stored.remove
        }
    })

    getJobs = vi.fn().mockImplementation(async () => {
        return Array.from(jobsStore.values())
    })
}

export default {
    Queue: mockQueue,
    QueueEvents: class {
        on = vi.fn().mockReturnThis()
        close = vi.fn().mockResolvedValue(undefined)
    },
    Worker: class {
        on = vi.fn()
        close = vi.fn().mockResolvedValue(undefined)
    },
    QueueScheduler: class {
        close = vi.fn().mockResolvedValue(undefined)
    }
}

// __mocks__/bullmq.ts

