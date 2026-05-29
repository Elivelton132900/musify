import axios, { AxiosError } from "axios";
import { Request, Response, NextFunction } from "express";

export async function checkUserExists(req: Request, res: Response, next: NextFunction) {
    try {
        const { lastFmUser } = req.body;

        if (!lastFmUser) {
            res.status(400).json({ error: "Last fm user is required" });
            return;
        }

        const params = {
            method: "user.getinfo",
            user: lastFmUser,
            api_key: process.env.LAST_FM_API_KEY!,
            format: "json",
        };

        const response = await axios.get("https://ws.audioscrobbler.com/2.0/", { params });

        // Se chegou aqui, status é 2xx
        if (response.data?.error === 6 || response.data?.error === 3) {
            res.status(404).json({ error: `Last fm user ${lastFmUser} not founded` });
            return;
        }

        if (response.data?.user) {
            next();
            return;
        }

        res.status(404).json({ error: `Last.fm user "${lastFmUser}" not found` });
    } catch (error) {
        if (error instanceof AxiosError && error.response) {
            const { status, data } = error.response;
            // Last.fm retorna 404 com corpo { error: 6, message: "User not found" }
            if (status === 404 && data?.error === 6) {
                res.status(404).json({ error: `Last fm user ${req.body.lastFmUser} not founded` });
                return;
            }
            console.error("Error validating Last.fm user:", error.message);
            res.status(503).json({ error: "Unable to validate Last.fm user. Please try again." });
            return;
        }
        // Erro inesperado (ex.: rede)
        console.error("Unexpected error validating Last.fm user:", error);
        res.status(503).json({ error: "Unable to validate Last.fm user. Please try again." });
    }
}