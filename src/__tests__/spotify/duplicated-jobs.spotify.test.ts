import { beforeAll, describe, expect, it, vi } from "vitest";
import { Response, Request, NextFunction } from "express";
import request from "supertest";

vi.mock("ioredis", () => {
    class MockRedis {
        get = vi.fn().mockResolvedValue("null")
        set = vi.fn().mockResolvedValue("OK")
        del = vi.fn().mockResolvedValue("1")
        quit = vi.fn().mockRejectedValue("ok")
        on = vi.fn().mockReturnThis
    }

    return {
        default: MockRedis
    }
})

vi.mock("../../src/middlewares/csrf-protection.middleware", () => ({
    csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next()
}))

let callCount = 0

vi.mock("../../middlewares/job-with-same-url-exists-spotify.middleware", () => ({
    jobWithSameUrlExists: (_req: Request, res: Response, next: NextFunction) => {
        callCount++

        if (callCount > 1) {
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

vi.mock("../../middlewares/is-authenticated.spotify.middleware", () => ({
    isAuthenticatedSpotify: (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
        req.userId = "fakeUserId"
        req.spotifyToken = "fake-spotify-token-123"
        next()
    }
}))

import app from "../../app";
import { generateCsrfToken } from "../../middlewares/csrf-protection.middleware";

describe("POST /spotify/loved-tracks/comparison-jobs - duplicate jobs", () => {

    let validCsrfToken: string

    beforeAll(() => {
        validCsrfToken = generateCsrfToken();
    });

    callCount = 0

    it("Should return 409 when submitting the same job twice or more", async () => {

        const payload = {
            range: "long_short"
        }

        const firstResponse = await request(app)
            .post("/spotify/loved-tracks/comparison-jobs")
            .set("Cookie", "spotify_token=fake-token")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [
                `csrf_token=${validCsrfToken}`,
                "spotify_token=fake-token-123",
                "spotify_refresh_token=fake-refresh-token"
            ])
            .send(payload)

        const secondResponse = await request(app)
            .post("/spotify/loved-tracks/comparison-jobs")
            .set("Cookie", "spotify_token=fake-token")
            .set("Cookie", "spotify_token=fake-token")
            .set("x-csrf-token", validCsrfToken)
            .set("Cookie", [
                `csrf_token=${validCsrfToken}`])
            .send(payload)

        expect(firstResponse.status).toBe(202)
        expect(secondResponse.status).toBe(409)

    })
})