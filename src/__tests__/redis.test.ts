import { describe, it } from "vitest";
import { redis } from "../infra/redis";
import { expect } from "vitest";


describe("Redis Connection", () => {
    it("Should be able to connect to Redis and receive PONG", async () => {

        const pong = await redis.ping()
        expect(pong).toBe("PONG")

    }),

        it("Should be able to set and get a value", async () => {
            const testKey = "test:connection"
            const testValue = "working"

            const setResult = await redis.set(testKey, testValue)
            expect(setResult).toBe("OK")

            const getResult = await redis.get(testKey)
            expect(getResult).toBe(testValue)

            await redis.del(testKey)

        })
})