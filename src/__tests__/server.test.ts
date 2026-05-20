import { describe, it, expect } from "vitest";
import request from 'supertest'
import app from "../app";


describe("Server initialization", () => {
    it("Should respond with 200 OK on a known route (ex: /loginspotify", async () => {

        const response = await request(app).get('/loginspotify')
        
        expect(response.statusCode).toBe(302)
        expect(response.headers.location).toContain("accounts.spotify.com")
        
    })
})