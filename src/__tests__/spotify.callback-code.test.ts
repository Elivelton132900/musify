import { describe, expect, it } from "vitest";
import request from "supertest"
import app from "../app";
describe("Spotify callback code", () => {

    describe("Code not provided", () => {

        it("Should return 400 if there is no code", async () => {

            const response = await request(app)
                .get("/callbackspotify")
                // Sem code
            console.log("BODY ", response.body)

            expect(response.status).toBe(400)
            expect(response.body.validation.query.message).toBe(`"code" is required`)

        })

        it("Should return 400 when code is empty string ", async () => {
            const response = await request(app)
                .get("/callbackspotify?code=")

            console.log(response.body.error)
            expect(response.status).toBe(400)
            expect(response.body.error || response.body.validation).toBeDefined()
        }) 


        it("Should return 400 when code is null or undefined", async () => {
            const response = await request(app)
                .get("/callbackspotify?code=null")

            expect(response.status).toBe(400)
        })
    })

})