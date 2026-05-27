import { describe, expect, it } from "vitest"
import app from "../../app"
import request from "supertest"

describe("Spotify Authentication", () => {
    describe("GET /loginspotify", () => {
        it("Should redirect to SPotify authorization URL with status 302", async () => {
            const response = await request(app)
                .get("/loginspotify")
                .redirects(0)

            expect(response.status).toBe(302)
            expect(response.headers.location).toBeDefined()

            // Parâmetros de url
            expect(response.headers.location).toContain("response_type=code")
            expect(response.headers.location).toContain("client_id=")
            expect(response.headers.location).toContain("redirect_uri")
            expect(response.headers.location).toContain("scope=")

            // Verifica scopes
            expect(response.headers.location).toContain("user-read-email")
            expect(response.headers.location).toContain("user-read-private")
            expect(response.headers.location).toContain("user-top-read")
            expect(response.headers.location).toContain("user-library-read")
        }),

            it("Should contain the correct redirect_uri in URL", async () => {
                const response = await request(app)
                    .get("/loginspotify")
                    .redirects(0)

                const location = response.headers.location
                const clientIdMatch = location.match(/client_id=([^&]+)/)

                expect(clientIdMatch).toBeDefined()
                expect(clientIdMatch?.[1]).toBe(process.env.SPOTIFY_CLIENT_ID)
            }),

            it("Should contain the correct redirect_uri in URL", async () => {
                const response = await request(app)
                    .get("/loginspotify")
                    .redirects(0)

                const location = response.headers.location

                const redirectUriMatch = location.match(/redirect_uri=([^&]+)/)

                expect(redirectUriMatch).toBeDefined()
                expect(decodeURIComponent(redirectUriMatch?.[1] || '')).toBe(
                    process.env.SPOTIFY_REDIRECT_URI_LOGIN
                )
            })
    })
})
