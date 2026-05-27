import "dotenv/config"
import {
    ParamsBySource,
    RunThroughTypeResult,
    FetchPageResultSingle,
    TrackDataLastFm,
    CollectedTracksSingle,
    CollectedTracksDual,
    RecentTracks,
    trackRecentData,
} from "./../models/last-fm.model"
import { ParamsHash } from "../models/last-fm.auth.model"
import crypto from "crypto"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import { ParametersURLInterface } from "../models/last-fm.model"
import axios from "axios"
import { AxiosError } from "axios"
import { Agent as HttpsAgent } from "https"
import { Agent as HttpAgent } from "http"
import { redis } from "../infra/redis"
import { Job } from "bullmq"
import { rediscoverSpotifyQueue } from "../queues/rediscoverSpotify.queue"

dayjs.extend(utc)

export function createHash(content: ParamsHash) {
    const sortedKeys = Object.keys(content).sort()

    let concatenated = ""
    for (const key of sortedKeys) {
        const typedKey = key as keyof ParamsHash
        concatenated += key + content[typedKey]
    }

    concatenated += process.env.LAST_FM_SHARED_SECRET

    const api_sig: string = crypto
        .createHash("md5")
        .update(concatenated)
        .digest("hex")

    return api_sig
}

export function getLoginUrl(api_key: string): string {
    const params = new URLSearchParams({
        api_key,
    })

    return `http://www.last.fm/api/auth/?${params.toString()}`
}

export function deleteDuplicateKeepLatest<
    T extends { name: string; artist: string; date: { uts?: string | number } },
>(tracks: T[]) {
    const groups = new Map<string, T[]>()
    for (const track of tracks) {
        const artist =
            typeof track?.artist === "string"
                ? track.artist
                : (track.artist?.["#text"] ?? "")

        const key = normalize(track.name, artist)

        if (!groups.has(key)) {
            groups.set(key, [])
        }

        groups.get(key)!.push(track)
    }

    let results: T[] = []

    for (const [_key, tracks] of groups) {
        const greatestUts = Math.max(...tracks.map((a) => Number(a.date?.uts)))

        const greatestRegister = tracks.find(
            (a) => Number(a.date?.uts) === greatestUts,
        )!
        results.push(greatestRegister)
    }

    return results
}
export function deleteTracksNotInRange<
    T extends {
        name: string
        artist: string
        date: { uts?: string | number; "#text"?: string }
    },
>(
    rangeDays: number,
    referenceDate: dayjs.Dayjs,        // ← nova data de referência (candidateTo)
    recentTracks: T[],
    oldTracks: T[]
): T[] {
    const tracks = oldTracks
    // Data limite = referenceDate - rangeDays
    const limitDate = referenceDate.subtract(rangeDays, "days").unix()
    const groups = new Map<string, T>()

    for (const track of tracks) {
        const artist =
            typeof track.artist === "string"
                ? track.artist
                : track.artist["#text"]

        const key = normalize(track.name, artist)
        const uts = Number(track?.date?.uts)
        if (isNaN(uts)) continue

        const current = groups.get(key)
        if (!current || uts > Number(current.date?.uts)) {
            groups.set(key, track)
        }

        const updated = groups.get(key)
        // Calcula dias sem ouvir a partir da referenceDate (não da data atual)
        const daysWithoutListening = referenceDate
            .utc()
            .diff(
                dayjs.unix(Number(updated?.date.uts)).utc().startOf("day"),
                "day"
            )

        if (daysWithoutListening > rangeDays) {
            const updatedTrack = { ...updated! }
            updatedTrack.date!["#text"] =
                `Not listened during the analyzed period (${rangeDays} days)`
            groups.set(key, updatedTrack)
        }
    }

    return [...groups.values()].filter(
        (track) => Number(track.date?.uts) <= limitDate
    )
}
export function distinctArtists(
    alltracks: TrackDataLastFm[],
    maximumRepetition: number,
    order?: string,
): TrackDataLastFm[] {
    const artistTracks = new Map<string, TrackDataLastFm[]>()
    const mapDistincted = new Map<string, TrackDataLastFm[]>()

    for (const track of alltracks) {
        if (!artistTracks.has(track.artist)) {
            artistTracks.set(track.artist, [])
        }

        artistTracks.get(track.artist)!.push(track)
    }

    let tracksFlattened: TrackDataLastFm[] = Array.from(
        artistTracks.values(),
    ).flat()

    for (const track of tracksFlattened) {
        if (!mapDistincted.has(track.artist)) {
            mapDistincted.set(track.artist, [])
        }

        if (mapDistincted.get(track.artist)!.length < maximumRepetition) {
            mapDistincted.get(track.artist)!.push(track)
        }
    }

    return Array.from(mapDistincted.values()).flat()
}


export const normalize = (name: string, artist: string) => {
    return (name + "-" + artist)
        .toLowerCase()
        .normalize("NFKD") // separa acentos
        .replace(/[\u0300-\u036f]/g, "") // remove acentos
        .normalize("NFKC") // normaliza de volta
        .replace(/[\u00A0\u200B\uFEFF]/g, " ") // NBSP, ZWSP, BOM → espaço
        .replace(/[-–—−]/g, "-") // normaliza tipos de hífen
        .replace(/\s+/g, " ") // normaliza múltiplos espaços
        .trim()
}

interface safeAxiosOptions {
    retries?: number
    delay?: number
    silent?: boolean
    signal: AbortSignal
}

const http = axios.create({
    timeout: 15000,
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 16 }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 16 }),
})

export function isRetryableAxiosError(error: unknown): boolean {
    if (!(error instanceof AxiosError)) return false

    const isTimeout =
        error.code === "ECONNABORTED" ||
        error.message.toLowerCase().includes("timeout")

    const retryableStatus = [500, 502, 503, 504]
    const isRetryableStatus = retryableStatus.includes(
        error.response?.status ?? 0,
    )

    return isTimeout || isRetryableStatus
}

function abortableDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            return reject(new Error("Aborted"))
        }

        const timeout = setTimeout(resolve, ms)

        signal?.addEventListener("abort", () => {
            clearTimeout(timeout)
            reject(new Error("Aborted during delay"))
        })
    })
}

export async function safeAxiosGet<T>(
    url: string,
    params?: ParametersURLInterface,
    options?: safeAxiosOptions,
): Promise<T | null> {
    if (options?.signal.aborted) throw new JobCanceledError()

    const { retries = 3, delay = 10000, silent = false, signal } = options || {}

    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new JobCanceledError()

        try {
            if (signal?.aborted) throw new JobCanceledError()
            const response = await http.get<T>(url, { params, signal })
            const data: any = response.data
            if (signal?.aborted) throw new JobCanceledError()

            if (data?.error) {
                if (!silent)
                    console.warn("Last FM erro: ", data.error, data.message)

                if ([8].includes(data.error) && attempt < retries) {
                    await abortableDelay(delay, signal)
                    continue
                } else if ([29].includes(data.error) && attempt < retries) {
                    await abortableDelay(delay, signal)
                }
                return null
            }
            return data as T
        } catch (e: unknown) {
            if (options?.signal?.aborted) {
                const error = e as AxiosError
                const retryable = isRetryableAxiosError(error)
                if (retryable && !silent) {
                    console.warn("Retryable Axios error:", {
                        code: error.code,
                        status: error.response?.status,
                        url: error.config?.url,
                    })
                    return null
                }
                if (!silent) {
                    if (options?.signal?.aborted) {
                        throw new JobCanceledError()
                    }

                    console.error(
                        `🚨 Falha Axios (${error.response?.status ?? "sem status"}):`,
                        error.message,
                    )
                    console.log("erro na url ", url)
                    console.error(error.response?.data)
                    console.error(error.response?.status)
                    console.error(error.config?.url)
                }
                if (retryable && attempt < retries) {
                    if (signal?.aborted) throw new JobCanceledError()
                    await abortableDelay(delay, signal)
                    continue
                }
                return null
            }
            return null
        }
    }
    return null
}
function returnDates(params: ParametersURLInterface) {
    const startDayFromComparison =
        typeof params.comparisonFrom === "string"
            ? String(dayjs(params.comparisonFrom).startOf("day").utc().unix())
            : ""
    const endDayToComparison =
        typeof params.comparisonTo === "string"
            ? String(dayjs(params.comparisonTo).endOf("day").utc().unix())
            : ""

    const startDayFromCandidate =
        typeof params.candidateFrom === "string"
            ? String(dayjs(params.candidateFrom).startOf("day").utc().unix())
            : params.from
    const endDayToCandidate =
        typeof params.candidateTo === "string"
            ? String(dayjs(params.candidateTo).endOf("day").utc().unix())
            : params.to

    return {
        startDayFromComparison,
        endDayToComparison,
        startDayFromCandidate,
        endDayToCandidate,
    }
}

export function createParams(params: ParametersURLInterface): ParamsBySource {
    const {
        startDayFromComparison,
        endDayToComparison,
        startDayFromCandidate,
        endDayToCandidate,
    } = returnDates(params)
    return {
        type: "dual",
        candidate: [
            {
                ...params,
                from: String(startDayFromCandidate),
                to: String(endDayToCandidate),
                page: String(params.page),
            },
        ],
        comparison: [
            {
                ...params,
                from: String(startDayFromComparison),
                to: String(endDayToComparison),
                page: String(params.page),
            },
        ],
    }
}

function normalizeRecentTrack(track: trackRecentData): TrackDataLastFm {
    const artist =
        typeof track.artist === "string" ? track.artist : track.artist["#text"]

    return {
        artist,
        name: track.name,
        url: track.url,
        mbid: track.mbid,
        date: track.date,
        key: normalize(track.name, artist),
    }
}

function normalizeRecentTracks(
    raw: trackRecentData | trackRecentData[] | undefined,
): TrackDataLastFm[] {
    if (!raw) return []

    if (Array.isArray(raw)) {
        return raw.map((a) => normalizeRecentTrack(a))
    }

    return [normalizeRecentTrack(raw)]
}

export async function fetchPageSingle(
    signal: AbortSignal,
    params: ParametersURLInterface,
): Promise<FetchPageResultSingle | null> {
    if (signal?.aborted) throw new JobCanceledError()
    const endpoint = "https://ws.audioscrobbler.com/2.0/"
    const response = await safeAxiosGet<RecentTracks>(endpoint, params, {
        signal,
    })
    if (signal?.aborted) throw new JobCanceledError()
    if (!response?.recenttracks) return null

    return {
        tracks: normalizeRecentTracks(response.recenttracks.track),
        pagination: {
            page: Number(response.recenttracks["@attr"]?.page),
            totalPages: Number(response.recenttracks["@attr"]?.totalPages),
        },
        "@attr": {
            user: response.recenttracks["@attr"]?.user ?? "",
            totalPages: response.recenttracks["@attr"]?.totalPages ?? "",
            page: response.recenttracks["@attr"]?.page ?? "",
            perPage: response.recenttracks["@attr"]?.perPage ?? "",
            total: response.recenttracks["@attr"]?.total ?? ""
        }
    }
}

async function runThroughType(
    signal: AbortSignal,
    createdParamsList: ParamsBySource,
): Promise<RunThroughTypeResult | null> {
    if (createdParamsList.type !== "dual") return null

    if (signal?.aborted) throw new JobCanceledError()
    const candidateFirst = await fetchPageSingle(
        signal,
        createdParamsList.candidate[0],
    )

    if (signal?.aborted) throw new JobCanceledError()
    const comparisonFirst = await fetchPageSingle(
        signal,
        createdParamsList.comparison[0],
    )

    if (!candidateFirst || !comparisonFirst) return null

    return {
        type: "dual",
        dual: {
            candidatePage: candidateFirst,
            comparisonPage: comparisonFirst,
        },
    }
}

async function collectPaginatedTracksSingle(
    firstPage: FetchPageResultSingle,
    baseParams: ParametersURLInterface,
    signal: AbortSignal,
    job: Job,
): Promise<CollectedTracksSingle> {
    const collected: TrackDataLastFm[] = []
    collected.push(...firstPage.tracks)

    const totalPages = firstPage.pagination.totalPages
    const totalTracksFromApi = Number(firstPage["@attr"].total)  // total real (ex: 12254)

    let cumulativeTracks = firstPage.tracks.length  // ← começa com a quantidade da 1ª página

    console.log(`Página 1 de ${totalPages} (+${firstPage.tracks.length} tracks)`)
    console.log(`Track ${cumulativeTracks} de ${totalTracksFromApi}`)

    for (let page = 2; page <= totalPages; page++) {  // ← começa da página 2
        const canceled = await throwIfCanceled(job, signal)
        if (canceled) {
            await redis.del(`bull:rediscover-loved-tracks-last-fm:${job.id}`)
            throw new JobCanceledError()
        }

        const data = await fetchPageSingle(signal, {
            ...baseParams,
            page: String(page),
        })

        if (!data?.tracks?.length) continue

        const tracksInThisPage = data.tracks.length
        cumulativeTracks += tracksInThisPage

        console.log(`Página ${page} de ${totalPages} (+${tracksInThisPage} tracks)`)
        console.log(`Track ${cumulativeTracks} de ${totalTracksFromApi}`)

        for (const track of data.tracks) {
            if (signal?.aborted) throw new JobCanceledError()
            collected.push(track)
        }
    }

    return {
        type: "single",
        tracks: new Map([["single", collected]]),
    }
}

export async function runThroughPages(
    params: ParametersURLInterface,
    signal: AbortSignal,
    job: Job,
): Promise<CollectedTracksSingle | CollectedTracksDual | []> {
    let createdParamsList = createParams({ ...params })

    const pagesFromType = await runThroughType(signal, createdParamsList)

    if (!pagesFromType) return []
    const candidateBase = createdParamsList.candidate[0]
    const comparisonBase = createdParamsList.comparison[0]

    try {
        const candidateCollected = await collectPaginatedTracksSingle(
            pagesFromType.dual.candidatePage,
            candidateBase,
            signal,
            job,
        )

        if (signal?.aborted) throw new JobCanceledError()
        const comparisonCollected = await collectPaginatedTracksSingle(
            pagesFromType.dual.comparisonPage,
            comparisonBase,
            signal,
            job,
        )
        if (signal?.aborted) throw new JobCanceledError()

        return {
            type: "dual",
            tracks: new Map<string, TrackDataLastFm[]>([
                ["candidate", candidateCollected.tracks.get("single") ?? []],
                ["comparison", comparisonCollected.tracks.get("single") ?? []],
            ]),
        }
    } catch (e) {
        if (signal.aborted) {
            console.log("Execução abortada corretamente")
            throw e
        }
        throw e
    }
}

export function normalizeTracks(oldComparisonTracks: TrackDataLastFm[]) {
    const normalized: TrackDataLastFm[] = oldComparisonTracks.map((t) => ({
        ...t,
        key: normalize(
            t.name ?? "",
            (typeof t.artist === "string" ? t.artist : t?.artist["#text"]) ??
            "",
        ),
    }))

    return normalized
}

export function groupTracksByKey(
    normalized: TrackDataLastFm[],
    uniqueKeys: Set<string>,
) {
    const grouped = new Map<string, TrackDataLastFm[]>()

    for (const track of normalized) {
        if (!uniqueKeys.has(track.key)) {
            continue
        }

        if (!grouped.has(track.key)) {
            grouped.set(track.key, [])
        }

        grouped.get(track.key)!.push(track)
    }

    return grouped
}

export function getLatestTracks(
    grouped: Map<string, TrackDataLastFm[]>,
    fetchInDays?: number,
) {
    const latestTracks = new Map<string, TrackDataLastFm>()

    for (const [key, tracks] of grouped.entries()) {
        const valid = tracks.filter(
            (x) => x.date?.uts && !isNaN(Number(x.date?.uts)),
        )
        if (valid.length === 0) continue

        const greatest = Math.max(...valid.map((t) => Number(t.date?.uts)))

        const latest = valid.find((t) => Number(t.date?.uts) === greatest)

        if (latest) latestTracks.set(key, latest)
    }

    return latestTracks
}

interface BuildRediscoverCacheKeyInterface {
    user: string
    candidateFrom: string
    candidateTo: string
    comparisonFrom: string
    comparisonTo: string
    distinct: undefined | number
    fetchInDays: number
}

export function buildRediscoverCacheKey(
    params: BuildRediscoverCacheKeyInterface,
) {
    const normalized = {
        user: params.user,
        candidateFrom: params.candidateFrom,
        candidateTo: params.candidateTo,
        comparisonFrom: params.comparisonFrom,
        comparisonTo: params.comparisonTo,
        distinct: params.distinct ?? null,
        fetchInDays: params.fetchInDays,
    }

    const hash = crypto
        .createHash("sha1")
        .update(JSON.stringify(normalized))
        .digest("hex")
    return `lastfm:rediscover:result:${normalized.user}:${hash}`
}

export function buildCacheKey(user: string, hash: string) {
    return `lastfm:rediscover:result:${user}:${hash}`
}

export class JobCanceledError extends Error {
    constructor() {
        super("JOB_CANCELED_OR_DELETED")
    }
}

export async function throwIfCanceled(
    job: Job,
    signal: AbortSignal,
): Promise<boolean> {
    if (signal.aborted) {
        return true
    }

    const canceled = await redis.get(`rediscover:cancel:lastfm:${job.id}`)
    const deleted = await redis.get(`rediscover:delete:lastfm:${job.id}`)

    // para que delete a chave de cancelamento e possa ser executado antes do tempo de encerramento padrão definido
    if (canceled || deleted) {
        // para que delete a chave de cancelamento e possa ser executado antes do tempo de encerramento padrão definido
        canceled
            ? await redis.del(`rediscover:cancel:lastfm:${job.id}`)
            : await redis.del(`rediscover:delete:${job.id}`)

        deleted
            ? await redis.del(`rediscover:cancel:lastfm:${job.id}`)
            : await redis.del(`rediscover:delete:${job.id}`)
        return true
    }

    return false
}

export async function addJobToQueue(
    candidateFrom: string,
    candidateTo: string,
    comparisonFrom: string,
    comparisonTo: string,
    lastFmUser: string,
    fetchInDays?: number,
    distinct?: number,
) {
    const job = await rediscoverSpotifyQueue.add(
        "rediscover-loved-tracks-spotify",
        {
            fetchInDays,
            distinct,
            candidateFrom,
            candidateTo,
            comparisonFrom,
            comparisonTo,
            lastFmUser
        },
        {
            removeOnComplete: {
                age: 60 * 60 * 24 * 10,
            },
            removeOnFail: false,
        },
    )

    return job
}