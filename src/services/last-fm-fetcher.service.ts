import "dotenv/config"

import {
    ParametersURLInterface,
    TrackDataLastFm,
    RecentTracks,
    topTracksAllTime,
    CollectedTracksSingle,
    OldComparison,
} from "./../models/last-fm.model"
import dayjs from "dayjs"
import {
    deleteDuplicateKeepLatest,
    deleteTracksNotInRange,
    distinctArtists,
    getLatestTracks,
    groupTracksByKey,
    JobCanceledError,
    normalizeTracks,
    runThroughPages,
} from "../utils/lastFmUtils"
import { LastFmFullProfile } from "../models/last-fm.auth.model"
import { safeAxiosGet } from "../utils/lastFmUtils"
import { redis } from "../infra/redis"
import { Job } from "bullmq"

export class LastFmFetcherService {
    private readonly endpoint = "https://ws.audioscrobbler.com/2.0/"

    async loopFetchApi(
        signal: AbortSignal,
        limit: number,
        user: string | LastFmFullProfile,
        page: number,
        from?: number,
        to?: number,
    ): Promise<RecentTracks[]> {
        const responses: RecentTracks[] = []

        while (true) {
            if (signal?.aborted) throw new JobCanceledError()
            const response = await safeAxiosGet<RecentTracks>(
                this.endpoint,
                {
                    method: "user.getrecenttracks",
                    limit: String(limit),
                    user: typeof user === "string" ? user : user.name,
                    from: String(from),
                    to: String(to),
                    api_key: process.env.LAST_FM_API_KEY!,
                    page: String(page),
                    format: "json",
                },
                { signal },
            )

            if (signal?.aborted) throw new JobCanceledError()

            if (!response || response.recenttracks.track.length === 0) {
                break
            }

            responses.push(response)
            page += 1
        }

        return responses
    }

    async getTopTracksAllTime(username: string, limit: string, signal: AbortSignal) {
        const params = {
            method: "user.gettoptracks",
            format: "json",
            user: username,
            period: "overall",
            limit,
            api_key: process.env.LAST_FM_API_KEY!,
        }

        if (signal?.aborted) throw new JobCanceledError()
        const response = (await safeAxiosGet(this.endpoint, params, { signal })) as topTracksAllTime
        return response
    }


async getLastTimeMusicListened(
    signal: AbortSignal,
    params: ParametersURLInterface,
    job: Job,
) {
    // 1. Busca todas as tracks dos dois períodos (comparison e candidate)
    if (signal?.aborted) throw new JobCanceledError()
    const collected = (await runThroughPages(params, signal, job)) as CollectedTracksSingle
    if (signal?.aborted) throw new JobCanceledError()
    
    // 1.1 Extrai as tracks de cada período
    const recentCandidateTracks = collected?.tracks?.get("candidate") ?? []
    const oldComparisonTracks = collected?.tracks?.get("comparison") ?? []

    // 2. Normaliza os dois conjuntos (remove acentos, padroniza maiúsculas, etc.)
    const recentNormalized = normalizeTracks(recentCandidateTracks)
    const oldNormalized = normalizeTracks(oldComparisonTracks)

    // 3. Cria um Set com as chaves (nome|artista) das tracks recentes
    //    Isso permite O(1) lookup para verificar se uma música foi ouvida no período candidato
    const recentKeys = new Set(recentNormalized.map((t) => t.key))

    // 4. Encontra músicas que estão no período antigo (comparison) mas NÃO no período recente (candidate)
    const notListenedAnymore = oldNormalized.filter((t) => !recentKeys.has(t.key))
    
    // 5. Cria um Set com as chaves únicas das músicas potencialmente esquecidas
    const uniqueKeys = new Set(notListenedAnymore.map((t) => t.key))

    // 6. Agrupa as ocorrências da mesma música (ex: mesma música ouvida várias vezes)
    const groupedOld = groupTracksByKey(notListenedAnymore, uniqueKeys)

    // 7. Para cada música, mantém APENAS a ocorrência mais recente (última vez que foi ouvida)
    const latestTracks = getLatestTracks(groupedOld)

    // 8. Converte para o formato esperado
    const normalizedResults = Array.from(latestTracks.values()).map((t) => ({ ...t }))

    // 9. Remove duplicatas (garante que cada música apareça apenas uma vez)
    const oldComparison = normalizedResults.map((t) => ({ ...t }))
    let filtered = deleteDuplicateKeepLatest(oldComparison)
    
    // 9.1 Filtra apenas as que têm dados válidos (nome, artista e data)
    const safeOldComparison = oldComparison.filter(
        (t): t is OldComparison => !!t && !!t.artist && !!t.name && !!t.date,
    )

            const candidateStart = dayjs(params.candidateFrom).utc()
            const candidateEnd = dayjs(params.candidateTo).utc()
            const fetchInDays = candidateEnd.diff(candidateStart, "day")

    
    // 9.2 Aplica o filtro de "dias sem ouvir" usando a data de referência (candidateTo)
    const referenceDate = dayjs(params.candidateTo).utc().endOf("day")
    filtered = deleteTracksNotInRange(fetchInDays, referenceDate, filtered, safeOldComparison)

    // 10. Remove músicas que foram escutadas em QUALQUER MOMENTO no período candidato
    //     (reforça que a música não pode ter sido ouvida nem uma vez)
    const candidateKeys = new Set(recentCandidateTracks.map((t) => t.key))
    filtered = filtered.filter((track) => !candidateKeys.has(track.key))

    // 11. Customiza o texto da data para exibição
    const finalFiltered = filtered.map((track) => {
        const textBetweenDate = `(${params.comparisonFrom} → ${params.comparisonTo} and ${params.candidateFrom} → ${params.candidateTo})`

        // Se o período candidato termina hoje, mostra mensagem com fetchInDays
        // Caso contrário, mostra os intervalos completos
        const text = dayjs(params.candidateTo).isSame(dayjs(), "day")
            ? `Not listened during the analyzed period ${fetchInDays} days`
            : `Not listened within the selected periods ${textBetweenDate}`

        return {
            ...track,
            date: {
                uts: track.date.uts,
                "#text": text,
            },
        }
    })

    // 12. Retorna a lista final de músicas consideradas "esquecidas"
    return finalFiltered
}

    async rediscoverLovedTracks(
        userlastfm: string,
        fetchForDistinct: number | undefined,
        candidateFrom: string | undefined,
        candidateTo: string | undefined,
        comparisonFrom: string | undefined,
        comparisonTo: string | undefined,
        signal: AbortSignal,
        job: Job,
    ) {
        if (signal?.aborted) throw new JobCanceledError()

        let lastTimeListened: TrackDataLastFm[] = []
        let loopCount = 0

        let page = 1
        while (true && !signal.aborted) {
            if (signal?.aborted) throw new JobCanceledError()
            const canceled = await redis.get(`rediscover:cancel:lastfm:${job.id}`)

            if (canceled) {
                throw new JobCanceledError()
            }
            if (signal?.aborted) throw new JobCanceledError()
            loopCount += 1
            if (loopCount > 30) break

            const params: ParametersURLInterface = {
                comparisonFrom,
                comparisonTo,
                candidateFrom,
                candidateTo,
                method: "user.getrecenttracks",
                user: userlastfm,
                limit: "200",
                format: "json",
                page: String(page),
                api_key: process.env.LAST_FM_API_KEY!,
                from: "",
                to: "",
            }

            if (signal?.aborted) throw new JobCanceledError()
            const lastTimeListenedLoop = (await this.getLastTimeMusicListened(
                signal,
                params,
                job,
            )) as TrackDataLastFm[]
            if (signal?.aborted) throw new JobCanceledError()

            lastTimeListened.push(...lastTimeListenedLoop)
            lastTimeListened = deleteDuplicateKeepLatest(lastTimeListened)
            console.log("Tamanho final da resposta: ", lastTimeListened.length)
            break
        }

        console.log("antes, ", lastTimeListened.length)

        if (typeof fetchForDistinct === "number") {
            lastTimeListened = distinctArtists(lastTimeListened, fetchForDistinct)
        }

        console.log("depois>: ", lastTimeListened.length)

        return lastTimeListened
    }
}
