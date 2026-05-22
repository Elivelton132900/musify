import { describe, expect, it, vi } from "vitest";
import request from 'supertest';

vi.mock('ioredis', () => {
    return {
        default: vi.fn().mockImplementation(function (this: any) {
            this.get = vi.fn().mockResolvedValue(null);
            this.set = vi.fn().mockResolvedValue('OK');
            this.del = vi.fn().mockResolvedValue(1);
            this.quit = vi.fn().mockResolvedValue('OK');
            this.on = vi.fn().mockReturnThis();
            this.status = 'ready';
            return this;
        }),
    };
});

vi.mock('axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({
            data: {
                user: {
                    registered: {
                        unixtime: "1263177600" // Janeiro 2010
                    }
                }
            }
        })
    }
}));

interface Payload {
    candidateFrom: string,
    candidateTo: string,
    comparisonFrom: string,
    comparisonTo: string,
    distinct: string,
    lastFmUser: string
}

const payload: Payload = {
    candidateFrom: "2023-05-06",
    candidateTo: "2023-05-22",
    comparisonFrom: "2023-05-10",
    comparisonTo: "2027-05-05",
    distinct: "2",
    lastFmUser: "testuser",
};

const today = dayjs().format("YYYY/MM/DD")

const dateFields: (keyof Payload)[] = [
    "candidateFrom",
    "candidateTo",
    "comparisonFrom",
    "comparisonTo"
];

import app from "../app";
import dayjs, { Dayjs } from "dayjs";
import axios from "axios";

describe("validation of dates", () => {
    it("Should return 202 when passed a valid date", async () => {

        const payload = {
            candidateFrom: "2026-05-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-05-01",
            comparisonTo: "2026-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        }

        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        expect(response.status).toBe(202)
        expect(response.body).toBeDefined()
    })

    it("Should return 500 if candidateFrom is before ComparisonFrom", async () => {
        const payload = {
            candidateFrom: "2026-04-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-05-01",
            comparisonTo: "2026-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        }


        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        expect(response.status).toBe(500)
    })

    it("Should return 500 if periods overlap", async () => {
        const payload = {
            candidateFrom: "2026-04-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-04-01",
            comparisonTo: "2026-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        }

        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        expect(response.status).toBe(500)
    })

    it("Should return 500 if comparisonFrom is after comparisonTo", async () => {
        const payload = {
            candidateFrom: "2023-05-06",
            candidateTo: "2023-05-22",
            comparisonFrom: "2023-05-10",
            comparisonTo: "2023-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        };

        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        console.log(response.text)
        console.log(response.error)

        expect(response.status).toBe(500)
    })

    it("Should return 500 if candidateFrom is after CandidateTo", async () => {
        const payload = {
            candidateFrom: "2023-05-23",
            candidateTo: "2023-05-22",
            comparisonFrom: "2023-05-10",
            comparisonTo: "2023-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        };

        const response = await request(app)
            .post("/lastfm/loved-tracks/jobs")
            .send(payload)

        expect(response.status).toBe(500)
    })


    it("Should return 500 if date is in future", async () => {

        const isDateInFuture = dateFields.some((field) => {
            return dayjs(payload[field]).isAfter(today)
        })

        expect(isDateInFuture).toBeTruthy()
    })

    it("Should return true if using dates before account creation date", async () => {


        const payload = {
            candidateFrom: "2003-05-06",
            candidateTo: "2026-05-22",
            comparisonFrom: "2026-05-01",
            comparisonTo: "2026-05-05",
            distinct: 2,
            lastFmUser: "testuser",
        }

        const mockAxiosGet = vi.mocked(axios.get)
        const mockResponse = await mockAxiosGet.mock.results[0]?.value
        const userAccountCreationUnixDate = mockResponse.data.user.registered.unixtime
        const userAccountCreation = dayjs.unix(userAccountCreationUnixDate)
        const dateBeforeCreationAccount = dateFields.some((field) => {
            return dayjs(payload[field]).isBefore(dayjs(userAccountCreation))
        })

        expect(dateBeforeCreationAccount).toBeTruthy()

    })

})
