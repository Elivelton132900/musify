import { vi } from "vitest";

export function createMockAxiosInstance() {
    return {
        get: vi.fn().mockResolvedValue({
            data: {
                user: {
                    registered: {
                        unixtime: "1263177600"
                    }
                }
            }
        }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        put: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
        patch: vi.fn().mockResolvedValue({ data: {} }),
        defaults: { headers: { common: {} } },
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() }
        }
    };
}

const mockInstance = createMockAxiosInstance();

export default {
    get: vi.fn().mockResolvedValue({
        data: {
            user: {
                registered: {
                    unixtime: "1263177600"
                }
            }
        }
    }),
    create: vi.fn().mockReturnValue(mockInstance),
    isAxiosError: vi.fn().mockReturnValue(false)
};