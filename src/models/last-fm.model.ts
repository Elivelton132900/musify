import { Joi } from "celebrate"
import dayjs from "dayjs"

interface LastFmImage {
    size: string
    "#text": string
}

interface LastFmStreamable {
    fulltrack: string
    "#text": string
}

interface LastFmArtist {
    name: string
    url: string
    mbid: string
}

interface LastFmTrackAttr {
    rank: string
}

export class LastFmTrack {
    name: string
    mbid: string
    playcount: string
    duration: string
    url: string
    streamable: LastFmStreamable
    image: LastFmImage[]
    artist: LastFmArtist
    attr: LastFmTrackAttr

    constructor(data: any = {}) {
        this.name = data.name || ""
        this.mbid = data.mbid || ""
        this.playcount = data.playcount || "0"
        this.duration = data.duration || "0"
        this.url = data.url || ""
        this.streamable = data.streamable || { fulltrack: "0", "#text": "0" }
        this.image = (data.image || []).map((img: any) => ({
            size: img.size,
            "#text": img["#text"],
        }))
        this.artist = data.artist || { name: "", url: "", mbid: "" }
        this.attr = data["@attr"] || { rank: "" }
    }
}

/**
 * Representa os metadados do top tracks (ex: página, total, usuário)
 */
export interface LastFmTopTracksAttr {
    user: string
    totalPages: string
    page: string
    perPage: string
    total: string
}

/**
 * Representa o bloco completo de toptracks retornado pela API
 */
export class LastFmTopTracks {
    tracks: LastFmTrack[]
    attr: LastFmTopTracksAttr

    constructor(data: {
        toptracks: {
            track: LastFmTrack[]
            "@attr": LastFmTopTracksAttr
        }
    }) {
        // A resposta da API vem em data.toptracks
        this.tracks = data.toptracks.track
        this.attr = data.toptracks["@attr"]
    }
}

export interface TrackDataLastFm {
    artist: string
    name: string
    url: string
    mbid: string
    date: DateRecentTracks
    key: string
}

interface ArtistRecentTracks {
    mbid: string
    "#text": string
}

interface AlbumRecentTracks {
    mbid: string
    "#text": string
    url?: string
}

export interface DateRecentTracks {
    uts: string
    "#text": string
}

export interface trackRecentData {
    artist: ArtistRecentTracks
    streamable: string
    image: LastFmImage
    mbid: string
    album: AlbumRecentTracks
    name: string
    "@attr"?: { nowplaying: string }
    url: string
    date: DateRecentTracks
    playcount: string
    key: string | ""
}

interface Attr {
    user: string
    totalPages: string
    page: string
    perPage: string
    total: string
}

export interface RecentTracks {
    recenttracks: {
        track: trackRecentData[]
        "@attr"?: Attr
    }

    message?: string
    error?: number
}

interface Tag {
    name: string
    url: string
}

interface Wiki {
    published: string
    summary: string
}

interface Track {
    name: string
    mbid: string
    url: string
    duration: string
    streamable: LastFmStreamable
    listeners: string
    playcount: string
    artist: LastFmArtist
    album: AlbumRecentTracks
    image: LastFmImage[]
    userloved: string
    toptags: Tag[]
    wiki: Wiki
}

export interface TrackWithPlaycount {
    track: Track
}

export interface QuantityScrobbles {
    quantity: string
}

export interface topTracksAllTime {
    toptracks: {
        track: {
            streamable: LastFmStreamable
            mbid: string
            name: string
            image: LastFmImage[]
            artist: LastFmArtist
            url: string
            duration: string
            "@attr": Attr
        }[]
    }
}

export interface GetTracksByPercentage {
    track: trackRecentData
}

export interface getLastTimeMusicListened {
    track: TrackDataLastFm[]
    lastTimeListened: string[]
}

export interface ApiStructured {
    userplaycount: string
    artist: string
    name: string
    url: string
    mbid: string
    date: DateRecentTracks
    key: string
}

const DateSchema = Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((value, helpers) => {
        const isValid = dayjs(value, "YYYY-MM-DD", true).isValid()

        if (!isValid) {
            return helpers.error("any.invalid")
        }

        return value
    })
    .messages({
        "string.pattern.base": "Date must be in format YYYY-MM-DD",
        "any.invalid": "Date does not exist in calendar",
    })

export const rediscoverLovedTracks = Joi.object({
    distinct: Joi.alternatives()
        .try(Joi.boolean().valid(false), Joi.number().integer().min(1))
        .default(false),
    candidateFrom: DateSchema.required(),
    candidateTo: DateSchema.required(),
    comparisonFrom: DateSchema.required(),
    comparisonTo: DateSchema.required(),
    lastFmUser: Joi.string().required(),
})

export const jobIdRediscoverLovedTracks = Joi.object({
    jobId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
})

export type RediscoverLovedTracksBody = {
    fetchInDays: number
    distinct: undefined | number
    candidateFrom: string
    candidateTo: string
    comparisonFrom: string
    comparisonTo: string
    lastFmUser: string
    disctinct?: number | undefined,
    jobIdMocked?: string
    delay?: number
}

export interface FetchPageResultSingle {
    tracks: TrackDataLastFm[]
    pagination: {
        page: number
        totalPages: number
    }
    "@attr": {
        user: string
        totalPages: string
        page: string
        perPage: string
        total: string
    }
}

export interface ParametersURLInterface {
    comparisonFrom?: dayjs.Dayjs | string | undefined
    comparisonTo?: dayjs.Dayjs | string | undefined

    candidateFrom?: dayjs.Dayjs | string | undefined
    candidateTo?: dayjs.Dayjs | string | undefined

    from?: string
    to?: string

    fetchInDays?: string

    method?: string
    user: string
    limit?: string
    format: string
    page?: string
    api_key: string
}

export type ParamsBySource = {
    type: "dual"
    candidate: ParametersURLInterface[]
    comparison: ParametersURLInterface[]
}

export type RunThroughTypeResult = {
    type: "dual"
    dual: {
        candidatePage: FetchPageResultSingle
        comparisonPage: FetchPageResultSingle
    }
}

export type CollectedTracksSingle = {
    type: "single"
    tracks: Map<string, TrackDataLastFm[]>
}

export type CollectedTracksDual = {
    type: "dual"
    tracks: Map<string, TrackDataLastFm[]>
}

export type ObjectId = {
    jobId: string
}

export type DeleteRoute = {
    jobId: string
    spotifyId: string
    lastFmUser: string
}

export type OldComparison = {
    artist: string
    name: string
    url: string
    mbid: string
    date: DateRecentTracks
    key: string
}
