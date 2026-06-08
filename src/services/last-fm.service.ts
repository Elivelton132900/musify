import { RediscoverLovedTracksBody } from "../models/last-fm.model.js"
import { LastFmFetcherService } from "./last-fm-fetcher.service.js"
import { Job } from "bullmq"

export class LastFmService {
    private readonly fetcher: LastFmFetcherService
    constructor() {
        this.fetcher = new LastFmFetcherService()
    }

    async rediscoverLovedTracks(
        username: string,
        queryParams: RediscoverLovedTracksBody,
        signal: AbortSignal,
        job: Job,
    ) {
        return await this.fetcher.rediscoverLovedTracks(
            username,
            queryParams.fetchInDays ?? 0,
            queryParams.distinct,
            queryParams.candidateFrom,
            queryParams.candidateTo,
            queryParams.comparisonFrom,
            queryParams.comparisonTo,
            signal,
            job,
        )
    }
}
