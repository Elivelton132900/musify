import { Request, Response } from "express"
import {
    exchangeCodeForToken,
    getLoginUrl,
    getSpotifyUserProfile,
} from "../utils/spotifyUtils.js"
import jwt from "jsonwebtoken"
import { SpotifyUserPayload } from "../models/spotify.auth.model.js"
import { generateCsrfToken } from "../middlewares/csrf-protection.middleware.js"

export class AuthSpotifyController {
    static async login(req: Request, res: Response) {
        const authUrl = getLoginUrl()
        res.redirect(authUrl)
    }

    static async callback(req: Request, res: Response): Promise<void> {
        const code = req.query.code as string

        if (!code) {
            res.status(400).json({ error: "Code not provided" })
            return
        }

        const tokens = await exchangeCodeForToken(code)
        const user = await getSpotifyUserProfile(tokens.access_token)

        const expiresInSeconds = Number(tokens.expires_in)

        const payload = {
            spotifyId: user.spotifyId,
            userId: user.spotifyId,
            email: user.email,
            display_name: user.display_name,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + expiresInSeconds * 1000,
        } as SpotifyUserPayload

        const token = jwt.sign(payload, process.env.JWT_SECRET!, {
            expiresIn: "1h",
        })

        res.cookie("spotify_token", token, {
            httpOnly: true,
            // se der erro, mudar para false em dev e em prod mudar para true
            secure: true,
            sameSite: "strict",
            maxAge: 3600000,
            path: "/",
        })


        // Após login bem-sucedido, antes de enviar a resposta:
        const csrfToken = generateCsrfToken()
        res.cookie("csrf_token", csrfToken, {
            httpOnly: false, // necessário para o frontend ler
            secure: true,
            sameSite: "strict",
            maxAge: 3600000,
            path: "/",
        })

        res.json({
            message: "Login Successful",
            csrf_token: csrfToken, // frontend guarda para enviar nas requisições
            user: {
                id: user.spotifyId,
                name: user.display_name,
            },
            //apagar
            spotify_token: token,
        })
    }
}
