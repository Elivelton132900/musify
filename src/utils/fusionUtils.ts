import dayjs from "dayjs"
import { TimeRange, TrackDataSpotify } from "../models/spotify.model"
import { Job } from "bullmq"
import { redis } from "../infra/redis"
import { safeAxiosGet } from "./lastFmUtils"
import { JobCanceledError } from "./spotifyUtils"
import { RecentTracks, trackRecentData } from "../models/last-fm.model"
import zlib from "zlib"
import { lastFmFusionFormat, LastFmHistory } from "../models/fusion.model"
import { SpotifyService } from "../services/spotify.service"
import { lastFmMapper } from "./lastFmMapper"
import { fusionMapper } from "./fusionMapper"
import { SpotifyMapper, SpotifyMapperSavedTracks } from "./spotifyMapper"

export const dateBasedOnRange = (range: {
    firstCompare: TimeRange
    secondCompare: TimeRange.loved_tracks
}): string[] => {
    const finalDate = dayjs().format("YYYY-MM-DD")

    if (range.firstCompare === TimeRange.long) {
        const initialDate = dayjs().subtract(12, "month").format("YYYY-MM-DD")

        return [initialDate, finalDate]
    } else if (range.firstCompare === TimeRange.medium) {
        const initialDate = dayjs().subtract(6, "month").format("YYYY-MM-DD")

        return [initialDate, finalDate]
    }

    const initialDate = dayjs().subtract(4, "week").format("YYYY-MM-DD")

    return [initialDate, finalDate]
}

function normalizeString(str: string): string {
    return (
        str
            .toLowerCase()
            .trim()
            // Remove pontuação e caracteres especiais
            .replace(/[^\w\s]/g, "")
            // Normaliza espaços múltiplos
            .replace(/\s+/g, " ")
            // Remove acentos (opcional)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
    )
}

export function filterByLastFmHistory(
    spotifyForgottenTracks: TrackDataSpotify[],
    lastFmHistory: LastFmHistory[],
): TrackDataSpotify[] {
    if (!lastFmHistory || lastFmHistory.length === 0) {
        console.warn("there is no Last Fm history.")
        throw new Error("No Last Fm history found")
    }

    const listenedTracks = new Set(
        lastFmHistory.map(
            (track) =>
                `${normalizeString(track.name)}|${normalizeString(track.artist)}`,
        ),
    )

    const trulyForgottenTracks = spotifyForgottenTracks.filter((track) => {
        const trackKey =
            `${normalizeString(track.name || "")}|${normalizeString(track.artists?.[0]?.name || "")}`.toLowerCase()
        const isListened = listenedTracks.has(trackKey)
        return !isListened
    })

    console.log(
        `Last.fm filter: ${spotifyForgottenTracks.length} → ${trulyForgottenTracks.length} truly forgotten tracks`,
    )

    return trulyForgottenTracks
}

export async function throwIfCanceledFusion(
    job: Job,
    signal: AbortSignal,
    spotifyId: string,
    compare: { firstCompare: TimeRange; secondCompare: TimeRange },
): Promise<boolean> {
    if (signal.aborted) {
        return true
    }

    const canceled = await redis.get(`rediscover:cancel:fusion:${job.id}`)
    const deleted = await redis.get(`rediscover:delete:fusion:${job.id}`)

    if (canceled || deleted) {
        if (canceled) {
            await redis.del(`rediscover:cancel:fusion:${job.id}`)
        }
        if (deleted) {
            await redis.del(`rediscover:delete:fusion:${job.id}`)
        }

        // Deleta os caches do usuário
        await redis.del(`fusion:users:${spotifyId}:${compare.firstCompare}`)
        await redis.del(`fusion:users:${spotifyId}:${compare.secondCompare}`)

        return true
    }

    return false
}
function normalizeTracks(
    trackData: trackRecentData | trackRecentData[] | undefined,
): trackRecentData[] {
    if (!trackData) return []

    if (Array.isArray(trackData)) {
        return trackData as trackRecentData[]
    }

    if (typeof trackData === "object" && trackData !== null) {
        return [trackData]
    }

    return []
}

export async function compressMusics(
    musics: TrackDataSpotify[] | lastFmFusionFormat[],
): Promise<Buffer> {
    const compressedMusics = zlib.gzipSync(JSON.stringify(musics))

    return compressedMusics
}

export function descompressMusics<T>(musics: Buffer): T {
    const json = JSON.parse(zlib.gunzipSync(musics).toString()) as T

    return json
}

async function fetchWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delay = 1000,
): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn()
        } catch (error) {
            if (i === maxRetries - 1) throw error
            await new Promise((resolve) =>
                setTimeout(resolve, delay * Math.pow(2, i)),
            )
        }
    }
    throw new Error("Max retries exceeded")
}

export async function returnHistoryLastFm(
    initialDateFusion: string,
    finalDateFusion: string,
    signal: AbortSignal,
    userLastFm: string,
): Promise<trackRecentData[]> {
    console.log("INITIAL DATE AND FINAL ", initialDateFusion, finalDateFusion)
    const initialDate = dayjs(initialDateFusion).unix()
    const finalDate = dayjs().unix()
    let allTracks: trackRecentData[] = []
    let page = 1
    let totalPages = 1

    console.log("🔍 Datas do Last.fm:")
    console.log(
        "  from timestamp:",
        initialDate,
        "=",
        dayjs(initialDateFusion).format(),
    )
    console.log(
        "  to timestamp:",
        finalDate,
        "=",
        dayjs(finalDateFusion).format(),
    )
    console.log("  Data atual:", dayjs().format())

    while (page <= totalPages) {
        if (signal?.aborted) throw new JobCanceledError()

        const response = await fetchWithRetry(
            async () => {
                const result = await safeAxiosGet<RecentTracks>(
                    "https://ws.audioscrobbler.com/2.0/",
                    {
                        method: "user.getrecenttracks",
                        limit: "200",
                        user: userLastFm,
                        from: String(initialDate),
                        to: String(finalDate),
                        api_key: process.env.LAST_FM_API_KEY!,
                        page: page.toString(),
                        format: "json",
                    },
                    { signal },
                )

                if (!result?.recenttracks?.track) {
                    throw new Error(`Resposta inválida na página ${page}`)
                }

                return result
            },
            3, // maxRetries
            1000, // delay inicial
        )

        if (signal?.aborted) throw new JobCanceledError()

        const currentPageSize = response.recenttracks.track.length
        totalPages = parseInt(response.recenttracks["@attr"]?.totalPages || "1")
        const currentPage = parseInt(
            response.recenttracks["@attr"]?.page || "1",
        )
        const total = response.recenttracks["@attr"]?.total || "0"

        console.log(
            `Página ${currentPage}/${totalPages} - ${allTracks.length} tracks - Total de itens: ${total}`,
        )

        if (currentPageSize === 0) {
            console.log(`🏁 Nenhuma track na página ${page}, encerrando.`)
            break
        }

        const rawTracks = normalizeTracks(response.recenttracks.track)
        const validTracks = rawTracks.filter((track) => track.date?.uts)

        allTracks.push(...validTracks)
        page++
    }

    console.log(`✅ Total de tracks do Last.fm: ${allTracks.length}`)
    return allTracks
}

export const fetchTracksNotInCacheLovedTracks = async (
    signal: AbortSignal,
    access_token: string,
    spotifyId: string,
    job: Job,
    abortControllers: Map<string, AbortController>,
): Promise<void> => {
    try {
        const spotifyService = new SpotifyService()

        if (signal?.aborted) throw new JobCanceledError()

        const compare = TimeRange.loved_tracks

        const lovedTracks = await spotifyService.fetchLovedTracks(
            access_token,
            job,
            signal,
            spotifyId,
            compare
        )

        if (signal?.aborted) throw new JobCanceledError()

        if (!lovedTracks || lovedTracks.length === 0) {
            console.warn("Nenhuma loved track encontrada, não salvando cache")
            return
        }

        // Mapeia para o formato TrackDataSpotify
        const lovedTracksMapped = lovedTracks.map((track) =>
            SpotifyMapperSavedTracks.toTopTrackData(track)
        )

        const size = Buffer.byteLength(JSON.stringify(lovedTracksMapped), "utf8")
        const compressedLovedTracks = await compressMusics(lovedTracksMapped)

        console.log(
            `📊 loved_tracks (depois da compressão): ${(size / 1024).toFixed(2)} KB / ${(size / (1024 * 1024)).toFixed(2)} MB`
        )
        console.log(`📊 Número de tracks: ${lovedTracksMapped.length}`)

        await redis.set(
            `fusion:users:${spotifyId}:${TimeRange.loved_tracks}`,
            compressedLovedTracks,
            "EX",
            60 * 60 * 24,
        )

    } catch (err: any) {
        if (err instanceof JobCanceledError) {
            console.log("Job canceled by ", job.id)
            throw err
        }

        console.log("error: ", err)
        throw err
    } finally {
        abortControllers.delete(job.id!)
    }
}

export const fetchSingleRangeNotInCache = async (
    signal: AbortSignal,
    access_token: string,
    spotifyId: string,
    compare: { firstCompare: TimeRange; secondCompare: TimeRange.loved_tracks },
    job: Job,
    abortControllers: Map<string, AbortController>
): Promise<void> => {
    try {
        const spotifyService = new SpotifyService()

        if (signal?.aborted) throw new JobCanceledError()

        type TimeRangeKey = "short" | "medium" | "long"
        const timeRangeKey = compare.firstCompare.replace("_term", "") as TimeRangeKey

        const topMusics = await spotifyService.fetchTopTracks(
            access_token,
            timeRangeKey,
            job,
            signal
        )

        if (signal?.aborted) throw new JobCanceledError()

        if (!topMusics || topMusics.length === 0) {
            console.warn(`Nenhum resultado para o range: ${compare.firstCompare}`)
            return
        }

        const topMusicsMapped = topMusics.map((track) =>
            SpotifyMapper.toTopTrackData(track)
        )

        const size = Buffer.byteLength(JSON.stringify(topMusicsMapped), "utf8")
        const compressedData = await compressMusics(topMusicsMapped)

        console.log(
            `📊 Spotify (${compare.firstCompare}): ${(size / 1024).toFixed(2)} KB / ${(size / (1024 * 1024)).toFixed(2)} MB`
        )
        console.log(`📊 Número de tracks: ${topMusicsMapped.length}`)

        await redis.set(
            `fusion:users:${spotifyId}:${compare.firstCompare}`,
            compressedData,
            "EX",
            60 * 60 * 24
        )

    } catch (err: any) {
        if (err instanceof JobCanceledError) {
            console.log("Job canceled by ", job.id)
            throw err
        }

        console.log("error: ", err)
        throw err
    } finally {
        abortControllers.delete(job.id!)
    }
}

export const fetchLastFmNotInCache = async (
    compare: { firstCompare: TimeRange, secondCompare: TimeRange.loved_tracks },
    signal: AbortSignal,
    lastFmUser: string,
    job: Job,
    abortControllers: Map<string, AbortController>
) => {
    try {
        let initialDate: string = ""
        let finalDate: string = ""

            ;[initialDate, finalDate] = dateBasedOnRange(compare) as [
                string,
                string,
            ]

        if (signal?.aborted) throw new JobCanceledError()
        const lastFmResult = await returnHistoryLastFm(
            initialDate,
            finalDate,
            signal,
            lastFmUser,
        )
        if (signal?.aborted) throw new JobCanceledError()
        if (lastFmResult.length === 0) {
            console.warn("last fm returned no values")
            throw new Error("Last FM returned no values")
        }

        const LastResultSize = Buffer.byteLength(
            JSON.stringify(lastFmResult),
            "utf8",
        )
        console.log(
            `📊 LastFM (antes da compressão): ${(LastResultSize / 1024).toFixed(2)} KB / ${(LastResultSize / (1024 * 1024)).toFixed(2)} MB`,
        )
        console.log(`📊 Número de tracks: ${lastFmResult.length}`)

        if (signal.aborted) return

        const lastFmMapped = lastFmMapper.recentDataToTrackData(lastFmResult)
        const lastFmFormatted = fusionMapper.lastFmToFusionFormat(
            lastFmMapped,
            compare,
        )

        const lastFmFormattedCompressed = await compressMusics(lastFmFormatted)

        await redis.set(
            `fusion:users:${lastFmUser}:lastfm:${compare.firstCompare}`,
            lastFmFormattedCompressed,
            "EX",
            60 * 60 * 24,
        )
    } catch (err: any) {
        if (err instanceof JobCanceledError) {
            console.log("Job canceled by ", job.id)
            throw err
        }

        console.log("error: ", err)
        throw err
    } finally {
        abortControllers.delete(job.id!)
    }
}
