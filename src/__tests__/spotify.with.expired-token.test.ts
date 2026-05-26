import request from "supertest";
import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import app from "../app";
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware";
import jwt from "jsonwebtoken"
// import { AuthenticatedRequest } from "../middlewares/is-authenticated.spotify.middleware";
// import { NextFunction, Response } from "express";


// vi.mock("../middlewares/is-authenticated.spotify.middleware", () => ({
//   isAuthenticatedSpotify: (
//     req: AuthenticatedRequest,
//     res: Response,
//     next: NextFunction
//   ) => {
//     console.log("🔵 MOCK isAuthenticatedSpotify FOI CHAMADO!")
//     req.spotifyUser = {
//       spotifyId: "fake-spotify-user-id",
//       userId: "test-user-id-456",
//       email: "test@example.com",
//       name: "Test User",
//       access_token: "fake-access-token",
//       refresh_token: "fake-refresh-token",
//       expires_at: Date.now() + 3600000,
//       iat: Date.now(),
//       exp: Date.now() + 3600000
//     };
//     next();
//   }
// }));


// vi.mock("../middlewares/job-with-same-url-exists-spotify.middleware", () => ({
//   jobWithSameUrlExists: (_req: Request, _res: Response, next: NextFunction) => {
//     console.log("🔵 MOCK jobWithSameUrlExists FOI CHAMADO!")
//     next()
//   }
// }));


describe("Spotify - Token and CSRF Tests", () => {
  let csrf_token: string

  beforeAll(() => {
    csrf_token = generateCsrfToken()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Configuração de todos os endpoints
  const endpoints = [
    {
      method: 'post',
      url: '/spotify/loved-tracks/comparison-jobs',
      body: { range: 'long_short' },
      requiresAuth: true,
      requiresCsrf: true
    },
    {
      method: 'post',
      url: '/spotify/loved-tracks/jobs/123/cancel',
      body: undefined,
      requiresAuth: false,
      requiresCsrf: true
    },
    {
      method: 'delete',
      url: '/spotify/loved-tracks/jobs/123',
      body: undefined,
      requiresAuth: false,
      requiresCsrf: true
    }
  ]

  // Testes para token expirado (apenas endpoints com auth)
  describe('Expired Token Tests (401)', () => {
    const authEndpoints = endpoints.filter(e => e.requiresAuth)



    authEndpoints.forEach(({ method, url, body }) => {
      it(`${method.toUpperCase()} ${url} should return 401 when token is expired`, async () => {
        const verifySpy = vi.spyOn(jwt, 'verify')
        const expiredError = new jwt.TokenExpiredError("jwt expired", new Date())

        verifySpy.mockImplementationOnce(() => {
          throw expiredError
        })

        const response = await (request(app) as any)[method](url)
          .set('x-csrf-token', csrf_token)
          .set('Cookie', [
            `csrf_token=${csrf_token}`,
            `spotify_token=token_expirado`
          ])
          .send(body || {})

        expect(response.status).toBe(401)
        expect(response.body.error).toBe("Token expired")

        verifySpy.mockRestore()
      })

      it(`${method.toUpperCase()} ${url} should return 401 when token is invalid`, async () => {
        const verifySpy = vi.spyOn(jwt, 'verify')

        verifySpy.mockImplementationOnce(() => {
          throw new Error('invalid token')
        })

        const response = await (request(app) as any)[method](url)
          .set('x-csrf-token', csrf_token)
          .set('Cookie', [
            `csrf_token=${csrf_token}`,
            `spotify_token=token_invalido`
          ])
          .send(body || {})

        expect(response.status).toBe(401)
        expect(response.body.error).toBe("Invalid token")

        verifySpy.mockRestore()
      })
    })
  })

  // Testes para CSRF (403) - todos os endpoints com CSRF
  describe('CSRF Protection Tests (403)', () => {
    const csrfEndpoints = endpoints.filter(e => e.requiresCsrf)

    csrfEndpoints.forEach(({ method, url, body }) => {
      it(`${method.toUpperCase()} ${url} should return 403 when CSRF token is missing`, async () => {
        const response = await (request(app) as any)[method](url)
          .send(body || {})

        expect(response.status).toBe(403)
        expect(response.body.error).toBe("Invalid CSRF token")

        console.log("DADOS ", response.body, response.status)
      })

      it(`${method.toUpperCase()} ${url} should return 403 when CSRF token is wrong`, async () => {
        const response = await (request(app) as any)[method](url)
          .set('x-csrf-token', 'wrong_token')
          .set('Cookie', [`csrf_token=${csrf_token}`])
          .send(body || {})

        expect(response.status).toBe(403)
        expect(response.body.error).toBe("Invalid CSRF token")
      })
    })
  })
})