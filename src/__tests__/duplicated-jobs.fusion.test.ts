import { describe, expect, it, vi } from "vitest";
import { Request, Response, NextFunction} from "express";
import request  from "supertest";
vi.mock("ioredis", () => {
    class MockRedis {
        get = vi.fn().mockResolvedValue("null")
        set = vi.fn().mockResolvedValue("OK")
        del = vi.fn().mockResolvedValue(1)
        quit = vi.fn().mockResolvedValue("OK")
        on = vi.fn().mockReturnThis
    }

    return {
        default: MockRedis
    }
})

let counter = 0
vi.mock("../middlewares/job-with-same-url-exists-fusion.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, res: Response, next: NextFunction) => {
        counter++

        if (counter > 1 ){
            res.status(409).json({ error: "Job already exists" })
            return
        }
        
        next()
    }
}))

interface AuthenticatedRequest extends Request {
    userId?: string,
    spotifyToken?: string
}

vi.mock("../middlewares/is-authenticated.spotify.middleware", () => ({
    isAuthenticatedSpotify: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        req.userId = "fakeUserId123"
        req.spotifyToken = "fakeSpotifyToken123"
        next()
    } 
}))


import app from "../app";
import { TimeRange } from "../models/spotify.model";

describe("POST /fusion/loved-tracks/jobs", () => {

    it("Should return 409 when submitting the same job twice or more", async () => {

        const payload ={
            compare: {
                firstCompare: "long_term",
                secondCompare: TimeRange.loved_tracks
            },
            lastFmUser: "fakeUser123"
        }

        const firstResponse = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .send(payload)
            .set("Cookie", [
                "spotify_token=fakeToken123",
                "spotify_refresh_token=fakeRefreshToken",
            ])

        const secondResponse = await request(app)
            .post("/fusion/loved-tracks/jobs")
            .send(payload)
            .set("Cookie", [
                "spotify_token=fakeToken123",
                "spotify_refresh_token=fakeRefreshToken",
            ])

        console.log("first ", firstResponse.text, firstResponse.error)
        console.log("second ", secondResponse.text, secondResponse.error)

        expect(firstResponse.status).toBe(202)
        expect(secondResponse.status).toBe(409)

    })

})