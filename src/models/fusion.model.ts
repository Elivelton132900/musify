import { Joi } from "celebrate"
import { TimeRange } from "./spotify.model"

export interface FusionBody {
    access_token: string
    spotifyId: string
    compare: { firstCompare: TimeRange; secondCompare: TimeRange.loved_tracks }
    lastFmUser: string
}

export interface lastFmFusionFormat {
    compareType?: TimeRange
    name: string
    artist: string
    date?: string
}

export interface LastFmHistory {
    name: string
    artist: string
    date?: string
}

export const BodyCompareFusion = Joi.object({
    compare: {
        firstCompare: TimeRange,
        secondCompare: TimeRange.loved_tracks
    }
}).required()


export interface BullMqJobInterface {
    params: {
        access_token: string,
        spotifyId: string,
        compare: {
            firstCompare: TimeRange,
            secondCompare: TimeRange.loved_tracks
        },
        lastFmUser: string
    }
}

export const fusionBodySchema = Joi.object({
    compare: Joi.object({
        firstCompare: Joi.string()
            .valid(...Object.values(TimeRange))
            .required(),
        secondCompare: Joi.string().valid(TimeRange.loved_tracks).required(),
    }),
    lastFmUser: Joi.string().required(),
})


export const CancelOrDeleteSchemaFusion = Joi.object({
    jobId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    lastFmUser: Joi.string().required(),
    spotifyId: Joi.string().required()
})
