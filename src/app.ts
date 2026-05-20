import express from "express"
import { routes } from "./routes"
import dotenv from "dotenv"
import { errorHandler } from "./middlewares/internal-server-error"
import { celebrateError } from "./middlewares/celebrate-error.middleware"
import cors from "cors"
import { notFound } from "./middlewares/page-not-found-error.middleware"
import cookieParser from "cookie-parser"

dotenv.config()

const app = express()

app.set("trust proxy", 1)

app.use(cookieParser())

app.use(
    cors({
        origin: "https://uncriticisably-rushier-rashida.ngrok-free.dev",
        credentials: true, // permite envio de cookies
    }),
)

routes(app)

app.use(notFound)

app.use(celebrateError)
app.use(errorHandler)

export default app