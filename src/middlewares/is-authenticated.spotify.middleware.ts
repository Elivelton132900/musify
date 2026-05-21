import jwt from "jsonwebtoken"
import "dotenv/config"
import { Request, Response, NextFunction } from "express"
import { SpotifyJWTPayload } from "../models/spotify.auth.model"

const JWT_SECRET = process.env.JWT_SECRET!

interface AuthenticatedRequest extends Request {
    spotifyUser?: SpotifyJWTPayload
}

export function isAuthenticatedSpotify(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    try {
        const token = req.cookies.spotify_token


        if (!token) {
            return res.status(401).json({
                error: "Not authenticated",
                message: "Please login with spotify",
            })
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as SpotifyJWTPayload
            req.spotifyUser = decoded
            next()
            return
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({
                    error: "Token expired",
                    message: "Please refresh your token",
                })
            }
            return res.status(401).json({
                error: "Invalid token",
                message: "Please try again",
            })
        }
    } catch (error) {
        console.error("Auth error: ", error)
        return res.status(500).json({ error: "Authentication error" })
    }
}
