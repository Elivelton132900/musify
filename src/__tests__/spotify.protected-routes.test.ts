import { beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import app from "../app"
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware"

describe("Protected Routes - authentication", () => {
    describe("Access protected route without token", () => {

        let csrfToKen: string

        beforeAll(() => {
            csrfToKen = generateCsrfToken()
        })


        it("Should return 401 when accessing /spotify/loved-tracks/comparison-jobs without token", async () => {

            const response = await request(app)
                .post("/spotify/loved-tracks/comparison-jobs")
                .set('x-csrf-token', csrfToKen)
                .set('Cookie', [`csrf_token=${csrfToKen}`])  // ← CSRF válido
                .send({ range: "long_short" })
            // sem cookie spotify_token

            expect(response.status).toBe(401)
            expect(response.body).toHaveProperty("error", "Not authenticated")
            expect(response.body).toHaveProperty("message", "Please login with spotify")
        })
    })
})