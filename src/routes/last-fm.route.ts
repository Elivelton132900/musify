import { celebrate, Segments } from "celebrate"
import { Router } from "express"
import expressAsyncHandler from "express-async-handler"
import { jobIdRediscoverLovedTracks, rediscoverLovedTracks } from "../models/last-fm.model"
import { LastFmController } from "../controllers/last-fm.controller"
import { resolveDateDefaults } from "../middlewares/resolve-date-defaults.middleware"
import { jobWithSameUrlExists } from "../middlewares/job-with-same-url-exists-last-fm.middleware"
import { checkUserExists } from "../middlewares/user-exists-last-fm.middleware"

export const lastFmRoutes = Router()

lastFmRoutes.get(
    "/lastfm/loved-tracks/jobs/:jobId",
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(LastFmController.getJob),
)

lastFmRoutes.post(
    "/lastfm/loved-tracks/jobs",
    checkUserExists,
    resolveDateDefaults,
    jobWithSameUrlExists,
    celebrate({
        [Segments.BODY]: rediscoverLovedTracks,
    }),
    expressAsyncHandler(LastFmController.rediscoverLovedTracks),
)

lastFmRoutes.post(
    "/lastfm/loved-tracks/jobs/:jobId/cancel",
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(LastFmController.cancelRediscover),
)

lastFmRoutes.get("/lastfm/loved-tracks/jobs", expressAsyncHandler(LastFmController.getJobs))

lastFmRoutes.delete(
    "/lastfm/loved-tracks/jobs/:jobId",
    celebrate({
        [Segments.PARAMS]: jobIdRediscoverLovedTracks,
    }),
    expressAsyncHandler(LastFmController.deleteRediscover),
)
