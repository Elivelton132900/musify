import dotenv from 'dotenv'
import { beforeAll, describe, expect, it } from 'vitest'

describe('Environment Variables', () => {
    // carrega .env antes dos testes
    beforeAll(() => {
        dotenv.config()
    })

    it('should load Spotify credentials', () => {
        expect(process.env.SPOTIFY_CLIENT_ID).toBeDefined()
        expect(process.env.SPOTIFY_CLIENT_SECRET).toBeDefined()
        expect(process.env.SPOTIFY_REDIRECT_URI_LOGIN).toBeDefined()

        // Verifica se não estão vazias
        expect(process.env.SPOTIFY_CLIENT_ID?.length).toBeGreaterThan(0)
        expect(process.env.SPOTIFY_CLIENT_SECRET?.length).toBeGreaterThan(0)
    })

    it('should load Last.fm credentials', () => {
        expect(process.env.LAST_FM_API_KEY).toBeDefined()
        expect(process.env.LAST_FM_API_KEY?.length).toBeGreaterThan(0)
    })

    it('should load JWT secret', () => {
        expect(process.env.JWT_SECRET).toBeDefined()
        expect(process.env.JWT_SECRET?.length).toBeGreaterThan(0)
    })

})
