import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { generateCsrfToken } from '../../middlewares/csrf-protection.middleware';


describe('User existence - chamada real à API do Last.fm', () => {
  it('deve retornar 404 quando o usuário não existe', async () => {
    const csrfToken = generateCsrfToken();

    const payload = {
      candidateFrom: "2026-01-01",
      candidateTo: "2027-02-02",
      comparisonFrom: "2025-02-01",
      comparisonTo: "2025-03-01",
      distinct: 2,
      lastFmUser: "usuario_que_nao_existe_123456", // nome inventado
    };

    const response = await request(app)
      .post("/lastfm/loved-tracks/jobs")
      .set("x-csrf-token", csrfToken)
      .set("Cookie", [`csrf_token=${csrfToken}`])
      .send(payload);

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found|not founded/i);
  });
});