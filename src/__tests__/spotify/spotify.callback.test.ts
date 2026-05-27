import axios from 'axios'
import { beforeEach } from 'node:test'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import app from '../../app'

vi.mock("axios")

const mockedAxios = vi.mocked(axios)

describe("Spotify Authentication", () => {
    describe("GET /callbackspotify", () => {

        beforeEach(() => {
            vi.clearAllMocks()
        })

        it("Should exchange code for token and return cookies with spotify_token and csrf_token", async () => {

            const mockCode = "test_auth_code_123"

            mockedAxios.post.mockResolvedValueOnce({
                data: {
                    access_token: "mock_access_token_123",
                    token_type: "Bearer",
                    expires_in: 3600,
                    refresh_token: "mock refresh_token_123",
                    scope: "user-read-email user-read-private"
                }
            })

            // Mock da resposta do perfil do usuário

            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    id: "spotify_user_123",
                    display_name: "Test User",
                    email: "test@gmail.com",
                    country: "BR",
                    product: "premium"
                }
            })

            const response = await request(app)
                .get(`/callbackspotify?code=${mockCode}`)

            // verifica status

            expect(response.status).toBe(200)

            // Verifica o body da resposta
            expect(response.body).toHaveProperty('message', 'Login Successful')
            expect(response.body).toHaveProperty('csrf_token')
            expect(response.body).toHaveProperty('user')
            expect(response.body.user).toHaveProperty('id', 'spotify_user_123')
            expect(response.body.user).toHaveProperty('name', 'Test User')

            // verifica cookies

            const cookies = response.headers['set-cookie']
            expect(cookies).toBeDefined()


            const cookiesArray = Array.isArray(cookies) ? cookies : [cookies]
            // procura pelo cookie spotify_token
            const spotifyTokenCookie = cookiesArray?.find(c => c.startsWith("spotify_token="))

            expect(spotifyTokenCookie).toBeDefined()
            expect(spotifyTokenCookie).toContain("HttpOnly")
            expect(spotifyTokenCookie).toContain("Path=/")


            // procura pelo cookie csrf_token

            const csrfTokenCookies = cookiesArray?.find(c => c.startsWith("csrf_token="))
            expect(csrfTokenCookies).toBeDefined()
            expect(csrfTokenCookies).not.toContain("HttpOnly")

            // verifica se as chamadas foram feitas corretamente

            expect(mockedAxios.post).toHaveBeenCalledTimes(1)
            expect(mockedAxios.post).toHaveBeenCalledWith(
                "https://accounts.spotify.com/api/token",
                expect.any(String),
                expect.objectContaining({
                    headers: { 'Content-Type': "application/x-www-form-urlencoded" }
                })
            )

        })

        it("Should return 400 if code is not providded", async () => {

            const mockCode = "INVALID_CODE"

            //mock erro api

            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 400,
                    data: { error: "invalid_grant" }
                }
            })

            const response = await request(app)
                .get(`/callbackspotify?code=${mockCode}`)



            expect(response.status).toBe(500)
            expect(response.body).toHaveProperty("error")

        })

    })
})