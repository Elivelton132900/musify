import { describe, expect, it, vi } from "vitest";
import { FusionJobData } from "../../controllers/fusion.controller";
import { TimeRange } from "../../models/spotify.model";
import { NextFunction, Request, Response } from "express"
import app from "../../app";
import request from "supertest";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";
import { redis } from "../../infra/redis";
import { trackDataSpotifyReturnValue } from "../example-response-fusion";
vi.mock("bullmq", async () => {
    const mod = await import("../__mocks__/bullmq.js")
    return mod.default
})
const jobData: FusionJobData = {
    params: {
        access_token: "1234",
        spotifyId: "testuserspotify",
        compare: {
            firstCompare: TimeRange.long,
            secondCompare: TimeRange.loved_tracks
        },
        lastFmUser: "testuserlastfm"
    }
};

vi.mock("../../middlewares/csrf-protection.middleware", () => ({
    csrfProtection: (_req: any, _res: any, next: any) => next(),
    generateCsrfToken: () => "mock-csrf-token-123"
}));

vi.mock("../../middlewares/job-with-same-url-exists-fusion.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => next()
}));

vi.mock("../../middlewares/is-authenticated.spotify.middleware", () => ({
    isAuthenticatedSpotify: (req: any, _res: Response, next: NextFunction) => {
        req.userId = "fakeUserId";
        req.spotifyToken = "fake-spotify-token-123";
        next();
    }
}));


vi.mock("jsonwebtoken", () => ({
    default: {
        decode: vi.fn(() => ({
            access_token: "fake-access-token-123",
            spotifyId: "fake-spotify-user-id"
        }))
    }
}))

const fusionJobsStore = new Map<string, any>();
vi.mock("../../queues/rediscoverFusion.queue", async () => {
    const { Queue } = await import("bullmq");

    const queue = new Queue("rediscover-fusion");


    const originalAdd = queue.add;

    queue.add = async (name: string, data: any) => {
    console.dir(data, { depth: null });
        const job = await originalAdd(name, data)

        const originalRemove = job.remove.bind(job);
        job.remove = async () => {
            fusionJobsStore.delete(job.id!);
            return originalRemove();
        };
        fusionJobsStore.set(job.id!, job);
        await redis.set(
            `fusion:users:${jobData.params.lastFmUser}:lastfm:${jobData.params.compare.firstCompare}`,
            JSON.stringify(trackDataSpotifyReturnValue),
            "EX",
            180

        )
        return job;
    };

    queue.getJob = async (id: string) => {
        const job = fusionJobsStore.get(id);
        return job || null;
    };

    return { rediscoverFusionQueue: queue };
});

describe("Spotify X Lastfm test", () => {
    const csrf = generateCsrfToken();

    it("Should wait for the worker to be completed and verify result", async () => {
        const payload = {
            compare: jobData.params.compare,
            lastFmUser: jobData.params.lastFmUser,
        };

        const response = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", csrf)
            .set("Cookie", [`csrf_token=${csrf}`])
            .set("Cookie", [`spotify_token=fake-spotify-token`])
            .send(payload);

        expect(response.status).toBe(202);
        const jobId = response.body.jobId;

        let jobRes;
        let state = "waiting";
        for (let i = 0; i < 30; i++) {
            jobRes = await request(app).get(`/fusion/loved-tracks/jobs/${jobId}`);
            state = jobRes.body.state;
            if (state === "failed" || state === "completed") break;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        expect(state).toBe("completed");
        expect(jobRes?.body.result).toBeDefined();
    });

    it("Should return cache if same job is being executed again", async () => {

        const cacheRedis = await redis.get(`fusion:users:${jobData.params.lastFmUser}:lastfm:${jobData.params.compare.firstCompare}`)

        expect(cacheRedis).toBeDefined()
    })

    it("Should return error if first compare is loved tracks", async () => {

        const payload = {
            compare: {
                firstCompare: TimeRange.loved_tracks,
                secondCompare: TimeRange.long
            },
            lastFmUser: jobData.params.lastFmUser,
            spotifyId: "spotifyuser123"
        }

        const response = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", csrf)
            .set("Cookie", [`csrf_token=${csrf}`])
            .set("Cookie", [`spotify_token=fake-spotify-token`])
            .send(payload);

        expect(response.status).toBe(400)
    })

    it("Should return error if some other user try to delete a job that isnt't their", async () => {
        const payload = {
            compare: jobData.params.compare,
            lastFmUser: jobData.params.lastFmUser,
        };

        const response = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .set("x-csrf-token", csrf)
            .set("Cookie", [`csrf_token=${csrf}`])
            .set("Cookie", [`spotify_token=fake-spotify-token`])
            .send(payload);

        expect(response.status).toBe(202);
        const jobId = response.body.jobId;

        let jobRes;
        let state = "waiting";
        for (let i = 0; i < 30; i++) {
            jobRes = await request(app).get(`/fusion/loved-tracks/jobs/${jobId}`);
            state = jobRes.body.state;
            if (state === "failed" || state === "completed") break;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        expect(state).toBe("completed");
        expect(jobRes?.body.result).toBeDefined();

        const payloadCancel = {
            jobId,
            lastFmUser: jobData.params.lastFmUser,
            spotifyId: "wrongSpotifyId"
        }

        const cancelResponse = await request(app)
            .post(`/fusion/loved-tracks/jobs/${jobId}/${jobData.params.lastFmUser}/${payloadCancel.spotifyId}/cancel`)
            .set("x-csrf-token", csrf)
            .set("Cookie", [`csrf_token=${csrf}`])
            .set("Cookie", [`spotify_token=fake-spotify-token`])
            .send(payloadCancel)

        expect(cancelResponse.status).toBe(401)
    })

});