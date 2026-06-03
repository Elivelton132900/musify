import { vi } from "vitest"

const memoryStore = new Map<string, string>()

export const mockRedis = vi.mock("../../infra/redis.ts", () => ({
    redis: {
        connect: vi.fn().mockResolvedValue(undefined),
        quit: vi.fn().mockResolvedValue(undefined),
        setex: vi.fn().mockImplementation(async (key: string, _ttl: number, value: unknown) => {
            memoryStore.set(key.toString(), String(value))
            return "OK"
        }),
        set: vi.fn().mockImplementation(async (key: string, value: string, ..._args: any[]) => {
            memoryStore.set(key.toString(), value)
            return "OK"
        }),
        get: vi.fn().mockImplementation(async (key: string) => {
            return memoryStore.get(key.toString()) || null
        }),
        del: vi.fn().mockResolvedValue(1),
        publish: vi.fn().mockResolvedValue(1),
        on: vi.fn().mockReturnThis(),
        disconnect: vi.fn().mockResolvedValue(undefined),
        duplicate: vi.fn().mockReturnThis(),
        keyPrefix: "",
        status: "ready",
        _clearMemory: () => memoryStore.clear()
    }
}))

export default { Redis: mockRedis }