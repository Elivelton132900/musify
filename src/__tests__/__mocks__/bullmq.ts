import { vi } from 'vitest'
import { TrackDataSpotify } from '../../models/spotify.model'
import { trackDataSpotifyReturnValue } from '../example-response-fusion'


const _process = process as any;
if (!_process.__jobsStore) {
    _process.__jobsStore = new Map<string, any>();
}
if (!_process.__nextId) {
    _process.__nextId = 1;
}

const jobsStore = _process.__jobsStore;

const mockQueue = class {
    constructor(name: string) {
        this.name = name
    }

    name: string

    add = vi.fn(async (name: string, data: any) => {
        const jobId = String(_process.__nextId++)

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

        const id = jobId.toString()

        const stored = jobsStore.get(id)

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


