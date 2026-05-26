import { jobIdRediscoverLovedTracks } from "./../models/last-fm.model"
import { Router } from "express"
import expressAsyncHandler from "express-async-handler"
import { SpotifyController } from "../middlewares/spotify.controller"
import { isAuthenticatedSpotify } from "../middlewares/is-authenticated.spotify.middleware"
import { jobWithSameUrlExists } from "../middlewares/job-with-same-url-exists-spotify.middleware"
import { celebrate, Segments } from "celebrate"
import { comparationRange } from "../models/spotify.model"
import { csrfProtection } from "../middlewares/csrf-protection.middleware"

export const spotifyRoutes = Router()


spotifyRoutes.post(
    "/spotify/loved-tracks/comparison-jobs",
    csrfProtection,
    isAuthenticatedSpotify,
    jobWithSameUrlExists,
    celebrate({
        [Segments.BODY]: comparationRange,
    }),
    expressAsyncHandler(SpotifyController.syncAndCompareTimeRange),
)

spotifyRoutes.post(
    "/spotify/loved-tracks/jobs/:jobId/cancel",
    csrfProtection,
    isAuthenticatedSpotify,
    jobWithSameUrlExists,
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(SpotifyController.cancelRediscover),
)

spotifyRoutes.get(
    "/spotify/loved-tracks/jobs/:jobId",
    csrfProtection,     
    isAuthenticatedSpotify,
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(SpotifyController.getJob),
)

spotifyRoutes.get("/spotify/loved-tracks/jobs", expressAsyncHandler(SpotifyController.getJobs))

spotifyRoutes.delete(
    "/spotify/loved-tracks/jobs/:jobId",
    csrfProtection,
    isAuthenticatedSpotify,
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(SpotifyController.deleteRediscover),
)