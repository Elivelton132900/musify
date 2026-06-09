import { Request, Response, NextFunction } from "express"
import dayjs from "dayjs"
import minMax from "dayjs/plugin/minMax"
import axios from "axios"
import { redis } from "../infra/redis"
import customParseFormat from "dayjs/plugin/customParseFormat"
import utc from "dayjs/plugin/utc"

function parseDate(
    value: unknown,
    fieldName: string,
    next: NextFunction,
) {
    if (value === undefined) {
        return undefined
    }

    if (typeof value !== "string") {
        next(new Error(`"${fieldName}" must be a string in YYYY-MM-DD format`))
        return null
    }

    const date = dayjs.utc(value, "YYYY-MM-DD", true)

    if (!date.isValid()) {
        next(
            new Error(
                `"${fieldName}" must be a valid date in YYYY-MM-DD format`,
            ),
        )
        return null
    }

    return date
}

dayjs.extend(minMax)
dayjs.extend(customParseFormat)
dayjs.extend(utc)

async function userAccountCreation(user: string) {
    const userAccountCreationExists = await redis.get(
        `rediscover:${user}:accountCreation`,
    )

    if (!userAccountCreationExists) {
        const params = {
            method: "user.getinfo",
            user: user,
            api_key: process.env.LAST_FM_API_KEY!,
            format: "json",
        }
        const endpoint = "https://ws.audioscrobbler.com/2.0/"
        const response = await axios.get(endpoint, {
            params: params,
        })
        const unixtimeAccountCreation = response.data.user.registered.unixtime
        console.log("response.data ", response.data)
        await redis.set(
            `rediscover:${user}:accountCreation`,
            String(unixtimeAccountCreation),
            "EX",
            60 * 60 * 24 * 10,
        )

        return response.data.user.registered.unixtime
    }

    return userAccountCreationExists
}

export async function resolveDateDefaults(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    try {
        const userLastFm = req.body.lastFmUser


        if (!userLastFm) {
            return next(new Error("Last.FM user not found in session"))
        }
        const userAccountCreationUnixDate = Number(
            await userAccountCreation(userLastFm),
        )

        const comparisonFrom = parseDate(
            req.body.comparisonFrom,
            "comparisonFrom",
            next,
        )

        if (comparisonFrom === null) return
        const comparisonTo = parseDate(
            req.body.comparisonTo,
            "comparisonTo",
            next,
        )
        if (comparisonTo === null) return

        const candidateFrom = parseDate(
            req.body.candidateFrom,
            "candidateFrom",
            next,
        )
        if (candidateFrom === null) return
        const candidateTo = parseDate(
            req.body.candidateTo,
            "candidateTo",
            next,
        )
        if (candidateTo === null) return


        // se candidateFrom for ANTES da data de comparisonFrom, ERRO, por que dados candidatos a serem comparados devem ser procurados depois da data de comparisonFrom.
        if (candidateFrom?.isBefore(comparisonFrom)) {
            return next(
                new Error(
                    "invalid comparison period: Candidate period must start after the comparison period begins",
                ),
            )
        }
        // se comparison cobre alguma parte do período candidate (overlap/interseção entre dois períodos)
        const hasOverlap =
            comparisonFrom?.isBefore(candidateTo) &&
            comparisonTo?.isAfter(candidateFrom)
        if (hasOverlap) {
            return next(
                new Error(
                    "Invalid comparison period: Comparison period must not overlap with the candidate period",
                ),
            )
        }

        // se comparisonFrom for DEPOIS da data comparisonTo, erro pois comparisonFrom deve ser uma data anterior a comparisonTo
        if (comparisonFrom?.isAfter(comparisonTo)) {
            return next(
                new Error(
                    `"Invalid comparison period: comparisonFrom" must be earlier than "comparisonTo"`,
                ),
            )
        }

        // se candidateFrom for DEPOIS de candidateTo, erro pois candidateFrom deve ser antes de candidateTo
        if (candidateFrom?.isAfter(candidateTo)) {
            return next(
                new Error(
                    `"Invalid candidate period: "candidateFrom" must be earlier than "candidateTo"`,
                ),
            )
        }
        // nenhum parametro de data deve ser ANTES da data de criação da conta
        const dateParametersBeforeCreationAccount =
            comparisonFrom!.unix() < userAccountCreationUnixDate ||
            comparisonTo!.unix() < userAccountCreationUnixDate ||
            candidateFrom!.unix() < userAccountCreationUnixDate ||
            candidateTo!.unix() < userAccountCreationUnixDate

        if (dateParametersBeforeCreationAccount) {
            return next(
                new Error(
                    "Date parameters must be after account creation date",
                ),
            )
        }
        // nenhum parametro de data deve estar no futuro
        const dateParametersInFuture =
            comparisonFrom?.isAfter(dayjs().utc()) ||
            comparisonTo?.isAfter(dayjs().utc()) ||
            candidateFrom?.isAfter(dayjs().utc()) ||
            candidateTo?.isAfter(dayjs().utc())

        if (dateParametersInFuture) {
            return next(new Error("Date parameters must not be in the future"))
        }


        next()
    } catch (error: unknown) {
        if (error instanceof Error) {
            return next(error)
        }

        return next(new Error("Unexpected error"))
    }
}
