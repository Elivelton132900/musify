import { SpotifyMapperSavedTracks } from "./../utils/spotifyMapper"
import {
    PaginatedResponse,
    SpotifySavedTracks,
    SpotifyUserTopItems,
    TimeRange,
    TrackDataSpotify,
} from "./../models/spotify.model"
import axios from "axios"
import { SpotifyMapper } from "../utils/spotifyMapper"
import {
    findTracksNotInSecondRange,
    JobCanceledError,
    throwIfCanceled,
} from "../utils/spotifyUtils"
import { redis } from "../infra/redis"
import zlib from "zlib"
import { Job } from "bullmq"
import { throwIfCanceledFusion } from "../utils/fusionUtils"

export class SpotifyService {
    async fetchTopTracks(
        access_token: string,
        time_range: Exclude<keyof typeof TimeRange, "loved_tracks">,
        job: Job,
        signal: AbortSignal,
    ): Promise<SpotifyUserTopItems[]> {
        console.log("fetchTopTracks - job.id:", job?.id)
        console.log(
            "🔍 fetchTopTracks - job.data:",
            JSON.stringify(job?.data, null, 2),
        )
        console.log("fetchTopTracks - time_range:", time_range)
        const items: SpotifyUserTopItems[] = []
        const timeRangeValue = TimeRange[time_range]
        let endpoint: string = `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRangeValue}&limit=50`

        do {
            const response = await axios.get<
                PaginatedResponse<SpotifyUserTopItems>
            >(endpoint, {
                headers: { Authorization: `Bearer ${access_token}` },
                signal,
            })
            items.push(...response.data.items)
            const next = response.data.next
            typeof next === "string" &&
                next.includes("https://api.spotify.com/v1/")

            if (
                typeof next === "string" &&
                next.includes("https://api.spotify.com/v1/")
            ) {
                console.log(
                    "Progressão: ",
                    response.data.offset,
                    response.data.total,
                )
                endpoint = next
            } else {
                endpoint = ""
            }

            const canceledSpotify = await redis.get(
                `rediscover:cancel:spotify:${job.id}`,
            )
            const deletedSpotify = await redis.get(
                `rediscover:delete:spotify:${job.id}`,
            )

            const canceledFusion = await redis.get(
                `rediscover:cancel:fusion:${job.id}`,
            )

            const deletedFusion = await redis.get(
                `rediscover:delete:fusion:${job.id}`,
            )

            if (canceledSpotify || deletedSpotify) {
                await redis.del(
                    `spotify:users:${job.data.params.spotifyId}:${job.data.compare.firstCompare}`,
                )
                await redis.del(
                    `spotify:users:${job.data.params.spotifyId}:${job.data.compare.secondCompare}`,
                )
                throw new JobCanceledError()
            }

            if (canceledFusion || deletedFusion) {
                await redis.del(
                    `fusion:users:${job.data.params.spotifyId}:${job.data.params.compare.firstCompare}`,
                )
                await redis.del(
                    `fusion:users:${job.data.params.spotifyId}:${job.data.params.compare.secondCompare}`,
                )
                throw new JobCanceledError()
            }
        } while (endpoint.includes("https://api.spotify.com/"))

        return items
    }


    async fetchLovedTracks(
        access_token: string,
        job: Job,
        signal: AbortSignal,
        spotifyId: string,
        firstCompare: TimeRange
    ) {
        const items: SpotifySavedTracks[] = []
        let endpoint = "https://api.spotify.com/v1/me/tracks?limit=50"
        do {
            const throwed = await throwIfCanceled(job, signal)
            const compare = { firstCompare, secondCompare: TimeRange.loved_tracks }
            const fusionThrowed = await throwIfCanceledFusion(job, signal, spotifyId, compare)
            if (throwed || fusionThrowed) throw new JobCanceledError()
            const response = await axios.get<
                PaginatedResponse<SpotifySavedTracks>
            >(endpoint, {
                headers: { Authorization: `Bearer ${access_token}` },
            })

            items.push(...response.data.items)
            console.log("progressão", response.data.offset, response.data.total)

            const next = response.data.next
            if (
                typeof next === "string" &&
                next.includes("https://api.spotify.com/v1/")
            ) {
                endpoint = next
            } else {
                endpoint = ""
                console.log("endpoint igual aspas vazias")
            }
            const canceled = await redis.get(
                `rediscover:cancel:spotify:${job.id}`,
            )
            const deleted = await redis.get(
                `rediscover:delete:spotify:${job.id}`,
            )
            if (canceled || deleted) {
                await redis.del(
                    `spotify:users:${job.data.params.spotifyId}:${job.data.params.compare.firstCompare}`,
                )
                await redis.del(
                    `spotify:users:${job.data.params.spotifyId}:${job.data.params.compare.secondCompare}`,
                )
                const throwed = await throwIfCanceled(job, signal)

                if (throwed) {
                    break
                }
            }
        } while (endpoint.includes("https://api.spotify.com/"))

        return items
    }

    isTimeRangeLovedTrack<T extends TimeRange>(
        range: TimeRange,
        target: T,
    ): range is T {
        return range === target
    }

    async syncTopMusics(
        access_token: string,
        spotifyId: string,
        time_range: TimeRange,
        job: Job,
        signal: AbortSignal,
    ) {
        console.log("🔍 syncTopMusics - time_range recebido:", time_range)

        if (!time_range) {
            throw new Error(`time_range is undefined!`)
        }

        const time_range_redis = await redis.getBuffer(
            `spotify:users:${spotifyId}:${time_range}`,
        )
        if (!time_range_redis) {
            if (
                this.isTimeRangeLovedTrack(TimeRange.loved_tracks, time_range)
            ) {
                const topMusics: SpotifySavedTracks[] =
                    await this.fetchLovedTracks(access_token, job, signal, spotifyId, time_range)
                const compressedTopMusics = zlib.gzipSync(
                    JSON.stringify(topMusics),
                )
                await redis.set(
                    `spotify:users:${spotifyId}:${time_range}`,
                    compressedTopMusics,
                    "EX",
                    60 * 60 * 24,
                )

                const topMusicsMapped = topMusics.map((track) =>
                    SpotifyMapperSavedTracks.toTopTrackData(track),
                )
                return topMusicsMapped
            } else {
                type TimeRangeKey = "short" | "medium" | "long"
                const timeRangeKey = time_range.replace(
                    "_term",
                    "",
                ) as TimeRangeKey
                const topMusics: SpotifyUserTopItems[] =
                    await this.fetchTopTracks(
                        access_token,
                        timeRangeKey,
                        job,
                        signal,
                    )

                const sizeBeforeBytes = Buffer.byteLength(JSON.stringify(topMusics), "utf8")
                const sizeBeforeKB = (sizeBeforeBytes / 1024).toFixed(2)
                const sizeBeforeMB = (sizeBeforeBytes / (1024 * 1024)).toFixed(2)

                console.log(`📊 Spotify (antes da compressão): ${sizeBeforeKB} KB / ${sizeBeforeMB} MB`)
                console.log(`📊 Número de tracks: ${topMusics.length}`)

                // Comprime
                const compressedTopMusics = zlib.gzipSync(JSON.stringify(topMusics))

                // Tamanho DEPOIS da compressão
                const sizeAfterBytes = compressedTopMusics.length
                const sizeAfterKB = (sizeAfterBytes / 1024).toFixed(2)
                const sizeAfterMB = (sizeAfterBytes / (1024 * 1024)).toFixed(2)

                console.log(`📊 Spotify (depois da compressão): ${sizeAfterKB} KB / ${sizeAfterMB} MB`)
                console.log(`📊 Número de tracks: ${topMusics.length}`)

                await redis.set(
                    `spotify:users:${spotifyId}:${time_range}`,
                    compressedTopMusics,
                    "EX",
                    60 * 60 * 24,
                )

                const topMusicsMapped = topMusics.map((track) =>
                    SpotifyMapper.toTopTrackData(track),
                )
                return topMusicsMapped
            }
        }

        const json = JSON.parse(zlib.gunzipSync(time_range_redis).toString())
        return json
    }

    async syncAllTopMusics(
        access_token: string,
        spotifyId: string,
        compareTimeRange: { firstCompare: TimeRange; secondCompare: TimeRange },
        job: Job,
        signal: AbortSignal,
    ) {
        const { firstCompare, secondCompare } = compareTimeRange

        const comparingShortAndMedium =
            (firstCompare === TimeRange.medium &&
                secondCompare === TimeRange.short) ||
            (firstCompare === TimeRange.short &&
                secondCompare === TimeRange.medium)

        const comparingShortAndLong =
            (firstCompare === TimeRange.long &&
                secondCompare === TimeRange.short) ||
            (firstCompare === TimeRange.short &&
                secondCompare === TimeRange.long)

        const comparingLongAndMedium =
            (firstCompare === TimeRange.long &&
                secondCompare === TimeRange.medium) ||
            (firstCompare === TimeRange.medium &&
                secondCompare === TimeRange.long)

        const comparingLongAndLoved =
            (firstCompare === TimeRange.long &&
                secondCompare === TimeRange.loved_tracks) ||
            (firstCompare === TimeRange.loved_tracks &&
                secondCompare === TimeRange.long)

        const comparingMediumAndLoved =
            (firstCompare === TimeRange.medium &&
                secondCompare === TimeRange.loved_tracks) ||
            (firstCompare === TimeRange.loved_tracks &&
                secondCompare === TimeRange.medium)

        if (comparingShortAndLong) {
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.long,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.short,
                job,
                signal,
            )
        } else if (comparingShortAndMedium) {
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.medium,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.short,
                job,
                signal,
            )
        } else if (comparingLongAndMedium) {
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.long,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.medium,
                job,
                signal,
            )
        } else if (comparingLongAndLoved) {
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.long,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.loved_tracks,
                job,
                signal,
            )
        } else if (comparingMediumAndLoved) {
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.medium,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.loved_tracks,
                job,
                signal,
            )
        } else {
            // comparingShortAndLoved
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.short,
                job,
                signal,
            )
            await throwIfCanceled(job, signal)
            await this.syncTopMusics(
                access_token,
                spotifyId,
                TimeRange.loved_tracks,
                job,
                signal,
            )
        }
    }

    async getTracksTimeRange(spotifyId: string, time_range: TimeRange) {
        const rawTracks = await redis.getBuffer(
            `spotify:users:${spotifyId}:${time_range}`,
        )
        if (!rawTracks) {
            return null
        }

        const parsed = JSON.parse(zlib.gunzipSync(rawTracks).toString())

        if (this.isTimeRangeLovedTrack(time_range, TimeRange.loved_tracks)) {
            return JSON.parse(
                parsed.map((track: SpotifySavedTracks) =>
                    SpotifyMapperSavedTracks.toTopTrackData(track),
                ),
            )
        }

        return JSON.parse(
            parsed.map((track: SpotifyUserTopItems) =>
                SpotifyMapper.toTopTrackData(track),
            ),
        )
    }

    async compareRanges(
        spotifyId: string,
        compareTimeRange: { firstCompare: TimeRange; secondCompare: TimeRange },
    ) {
        const { firstCompare, secondCompare } = compareTimeRange

        const firstRange = await redis.getBuffer(
            `spotify:users:${spotifyId}:${firstCompare}`,
        )
        const secondRange = await redis.getBuffer(
            `spotify:users:${spotifyId}:${secondCompare}`,
        )

        if (!firstRange || !secondRange) {
            return
        }

        if (this.isTimeRangeLovedTrack(secondCompare, TimeRange.loved_tracks)) {
            const firstRangeParsed = JSON.parse(
                zlib.gunzipSync(firstRange).toString(),
            ) as SpotifyUserTopItems[]
            const secondRangeParsed = JSON.parse(
                zlib.gunzipSync(secondRange).toString(),
            ) as SpotifySavedTracks[]

            const mappedFirstRange: TrackDataSpotify[] = firstRangeParsed.map(
                (track: SpotifyUserTopItems) =>
                    SpotifyMapper.toTopTrackData(track),
            )
            const mappedSecondRange: TrackDataSpotify[] = secondRangeParsed.map(
                (track: SpotifySavedTracks) =>
                    SpotifyMapperSavedTracks.toTopTrackData(track),
            )

            return findTracksNotInSecondRange(
                mappedFirstRange,
                mappedSecondRange,
                compareTimeRange,
            )
        }

        const firstRangeParsed = JSON.parse(
            zlib.gunzipSync(firstRange).toString(),
        ) as SpotifyUserTopItems[]
        const secondRangeParsed = JSON.parse(
            zlib.gunzipSync(secondRange).toString(),
        ) as SpotifyUserTopItems[]

        const mappedFirstRange: TrackDataSpotify[] = firstRangeParsed.map(
            (track: SpotifyUserTopItems) => SpotifyMapper.toTopTrackData(track),
        )
        const mappedSecondRange: TrackDataSpotify[] = secondRangeParsed.map(
            (track: SpotifyUserTopItems) => SpotifyMapper.toTopTrackData(track),
        )

        const comparationResult = findTracksNotInSecondRange(
            mappedFirstRange,
            mappedSecondRange,
            compareTimeRange,
        )
        return comparationResult
    }

    async syncAndCompare(
        access_token: string,
        spotifyId: string,
        compareTimeRange: { firstCompare: TimeRange; secondCompare: TimeRange },
        job: Job,
        signal: AbortSignal,
    ) {
        if (signal?.aborted) throw new JobCanceledError()
        await this.syncAllTopMusics(
            access_token,
            spotifyId,
            compareTimeRange,
            job,
            signal,
        )
        const comparation = await this.compareRanges(
            spotifyId,
            compareTimeRange,
        )
        return comparation
    }
}
