import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import app from "../app";
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware";
import jwt from "jsonwebtoken"

describe("Spotify expired token", async () => {

    let csrf_token: string

    beforeAll(() => {
        csrf_token = generateCsrfToken()
    })
    const expired_token = "123"

    it("Should return 401 when passed expired token in protected route (spotify/loved-tracks/comparison-jobs", async () => {

        const verifySpy = vi.spyOn(jwt, 'verify')

        const expiredError = new jwt.TokenExpiredError("jwt expired", new Date())

        verifySpy.mockImplementationOnce(() => {
            throw expiredError
        })

        expiredError.name = 'TokenExpiredError'
        const response = await request(app)
            .post("/spotify/loved-tracks/comparison-jobs")
            .set('x-csrf-token', csrf_token)
            .set('Cookie', [
                `csrf_token=${csrf_token}`,
                `spotify_token=${expired_token}`
            ])  // ← CSRF válido
            .send({ range: "long_short" })

        expect(response.status).toBe(401)
        console.log("response vody ", response.body)
        expect(response.body.error).toBe("Token expired")

    })
})