import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware";

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'

describe("CSRF Protection - Spotify Routes", () => {

    const csrfProtectedRoutes = [
        {
            method: 'post' as HttpMethod,
            url: '/spotify/loved-tracks/comparison-jobs',
            body: { range: 'long_short' }
        },
        {
            method: 'post' as HttpMethod,
            url: '/spotify/loved-tracks/jobs/123/cancel',
            body: undefined
        },
        {
            method: 'delete' as HttpMethod,
            url: '/spotify/loved-tracks/jobs/123',
            body: undefined
        }
    ]

    let validCsrfToken: string

    beforeAll(() => {
        validCsrfToken = generateCsrfToken()
    })

    csrfProtectedRoutes.forEach(({ method, url, body }) => {
        describe("Spotify testing", () => {
            it("Should return 403 when x-csrf-token header is missing", async () => {
                const response = await request(app)
                [method](url)
                    .send({ range: "long_short" })
                expect(response.status).toBe(403)
                expect(response.body.error).toBe("Invalid CSRF token")
            })

            it("Should return 403 when x-csrf-token header is wrong", async () => {
                const req = request(app)

                if (method === "post") {
                    const response = await req.post(url)
                        .set("x-csrf-token", "wrong-token-123")
                        .set("Cookie", [`csrf_token=${validCsrfToken}`])
                        .send(body || {})
                    expect(response.status).toBe(403)
                    expect(response.body.error).toBe("Invalid CSRF token")
                } else if (method === "delete") {
                    const response = await req
                        .delete(url)
                        .set("x-csrf-token", "wrong-token-123")
                        .set("Cookie", [`csrf_token=${validCsrfToken}`])
                        .send(body || {})

                    expect(response.status).toBe(403)
                    expect(response.body.error).toBe("Invalid CSRF token")
                }
            })

            it("Should not throw error when passed correct csfr token", () => {
                csrfProtectedRoutes.forEach(async ({ method, url, body }) => {
                    const response = await request(app)
                    [method](url)
                        .set("x-csrf-token", validCsrfToken)
                        .set("Cookie", [`csrf_token=${validCsrfToken}`])
                        .send(body)

                    expect(response.status).not.toBe(403)
                })
            })

            it("Should return 403 when DELETE request has no CSRF token", async () => {
                if (method === "delete") {
                    const response = await request(app)
                        [method](url)
                        .send(body)
                    
                    expect(response.status).toBe(403)
                }

            })
        })
    })
})