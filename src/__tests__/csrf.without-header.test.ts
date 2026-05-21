import { describe, expect, it } from "vitest";
import request  from "supertest";
import app from "../app";

describe("POST without CSRF token", () => { 
    it("should return 403 when x-csrf-token header is missing", async () => {
        const response = await request(app)
            .post("/spotify/loved-tracks/comparison-jobs")
            // sem header x-csrf-token
            // sem cookie csrf_token
            .send({ range: "long_short" })

        expect(response.status).toBe(403)
        expect(response.body.error).toBe("Invalid CSRF token")
    })
})