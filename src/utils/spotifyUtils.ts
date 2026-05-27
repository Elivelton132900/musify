import querystring from "querystring"
import axios from "axios"
import {
    RefreshToken,
    SpotifyCredentials,
    SpotifyUserProfileInfo,
} from "../models/spotify.auth.model.js"
import { dayjs } from "./dayJsConfig"
import { TimeRange, TrackDataSpotify } from "../models/spotify.model"
import { Job } from "bullmq"
import { redis } from "../infra/redis.js"
import { rediscoverSpotifyQueue } from "../queues/rediscoverSpotify.queue.js"

export function getLoginUrl(): string {
    const scope = "user-read-email user-read-private user-top-read user-library-read"
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        scope,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI_LOGIN!,
    })

    return `https://accounts.spotify.com/authorize?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<SpotifyCredentials> {
    const response = await axios.post(
        "https://accounts.spotify.com/api/token",
        querystring.stringify({
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.SPOTIFY_REDIRECT_URI_LOGIN!,
            client_id: process.env.SPOTIFY_CLIENT_ID,
            client_secret: process.env.SPOTIFY_CLIENT_SECRET,
        }),
        {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
    )

    const spotifyCredentials = new SpotifyCredentials(response.data)

    return {
        ...spotifyCredentials,
        expires_in: 3600
    }
}

export async function getSpotifyUserProfile(accessToken: string): Promise<SpotifyUserProfileInfo> {
    const response = await axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    })

    return {
        ...response.data,
        spotifyId: response.data.id,
    }
}

export async function refreshSpotifyToken(refresh_token: string) {
    const refreshData: RefreshToken = {
        grant_type: "refresh_token",
        refresh_token,
        client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
        client_secret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
    }

    const params = new URLSearchParams(refreshData)

    const response = await axios.post("https://accounts.spotify.com/api/token", params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })
    return response.data
}

export function hasTimePassed(expires_in: Date): boolean {
    const expires_in_dayjs = dayjs(expires_in).tz("America/Sao_Paulo")

    const now = dayjs().tz("America/Sao_Paulo")

    return now.isAfter(expires_in_dayjs)
}

export function findTracksNotInSecondRange(
    firstRange: TrackDataSpotify[],
    secondRange: TrackDataSpotify[],
    compareTimeRange: { firstCompare: TimeRange; secondCompare: TimeRange },
) {
    if (
        compareTimeRange.firstCompare !== "loved_tracks" &&
        compareTimeRange.secondCompare !== "loved_tracks"
    ) {
        console.log(compareTimeRange.firstCompare, compareTimeRange.secondCompare)
        const noMoreListenedTracks = firstRange.filter((track) => {
            const isStillListened = secondRange.some((t) => t.id === track.id)
            return !isStillListened
        })

        return noMoreListenedTracks
    }

    const isFirstRangeSavedTracks =
        firstRange.filter((item) => typeof item.added_at === "string").length > 0

    // Cenário: músicas que estão nas suas curtidas (loved_tracks)
    // mas que você NÃO escuta mais (não estão no seu short_term)

    if (isFirstRangeSavedTracks) {
        return firstRange.filter((track) => {
            const isStillListened = secondRange.some((t) => t.id === track.id)
            return !isStillListened
        })
    } else {
        const result = secondRange.filter((track) => {
            const isStillListened = firstRange.some((t) => t.id === track.id)
            return !isStillListened
        })
        return result
    }
}

export async function addJobToQueue(
    access_token: string,
    spotifyId: string,
    compare: { firstCompare: TimeRange; secondCompare: TimeRange },
) {
    const job = await rediscoverSpotifyQueue.add(
        "rediscover-loved-tracks-spotify",
        {
            access_token,
            spotifyId,
            compare,
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

export async function throwIfCanceled(job: Job, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
        return true
    }

    const canceled = await redis.get(`rediscover:cancel:spotify:${job.id}`)
    const deleted = await redis.get(`rediscover:delete:spotify:${job.id}`)
    // para que delete a chave de cancelamento e possa ser executado antes do tempo de encerramento padrão definido
    if (canceled || deleted) {
        // para que delete a chave de cancelamento e possa ser executado antes do tempo de encerramento padrão definido
        canceled
            ? await redis.del(`rediscover:cancel:spotify:${job.id}`)
            : await redis.del(`rediscover:delete:${job.id}`)
        return true
    }

    return false
}

export class JobCanceledError extends Error {
    constructor() {
        super("JOB_CANCELED_OR_DELETED")
    }
}
