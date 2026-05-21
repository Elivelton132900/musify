import { beforeAll, describe, expect, it } from "vitest"
import request from "supertest"
import app from "../app"
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware"

describe("Spotify Routes - Security Tests", () => {
  let csrfToken: string

  beforeAll(() => {
    csrfToken = generateCsrfToken()
  })

  // Configuração de todas as rotas e suas proteções
  const routesConfig = [
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

  // Testes para autenticação (401)
  describe('Authentication Required (401)', () => {
    const authRoutes = routesConfig.filter(route => route.requiresAuth)

    authRoutes.forEach(({ method, url, body }) => {
      it(`${method.toUpperCase()} ${url} should return 401 without token`, async () => {
        const req = request(app)
        let response: any

        if (method === 'post') {
          response = await req
            .post(url)
            .set('x-csrf-token', csrfToken)
            .set('Cookie', [`csrf_token=${csrfToken}`])
            .send(body || {})
        }

        expect(response.status).toBe(401)
        expect(response.body.error).toBe("Not authenticated")
      })
    })
  })

  // Testes para CSRF (403)
  describe('CSRF Protection Required (403)', () => {
    const csrfRoutes = routesConfig.filter(route => route.requiresCsrf)

    csrfRoutes.forEach(({ method, url, body }) => {
      it(`${method.toUpperCase()} ${url} should return 403 without CSRF token`, async () => {
        const req = request(app)
        let response: any

        if (method === 'post') {
          response = await req.post(url).send(body || {})
        } else if (method === 'delete') {
          response = await req.delete(url).send(body || {})
        }

        expect(response.status).toBe(403)
        expect(response.body.error).toBe("Invalid CSRF token")
      })
    })
  })
})