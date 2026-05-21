import express from "express"
import { authSpotifyRoutes } from "./auth.spotify.route"
import { spotifyRoutes } from "./spotify.route"
import { lastFmRoutes } from "./last-fm.route"
import { fusionRoutes } from "./fusion.route"

export const routes = (app: express.Express) => {
    app.use(express.json({ limit: "5mb" }))
    app.use(authSpotifyRoutes)
    app.use(lastFmRoutes)
    app.use(spotifyRoutes)
    app.use(fusionRoutes)
}
