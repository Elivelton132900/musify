import { Request, Response, NextFunction } from 'express'
import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
import axios from 'axios'
import { UserInformation } from '../models/last-fm.auth.model'
import { redis } from '../infra/redis'

dayjs.extend(minMax)

async function userAccountCreation(user: string) {
    const userAccountCreationExists = await redis.get(
        `rediscover:${user}:accountCreation`,
    )

    if (!userAccountCreationExists) {
        const params = {
            method: 'user.getinfo',
            user: user,
            api_key: process.env.LAST_FM_API_KEY!,
            format: 'json',
        }
        const endpoint = 'https://ws.audioscrobbler.com/2.0/'
        const userInfo = (await axios.get(endpoint, {
            params,
        })) as UserInformation

        const unixtimeAccountCreation = userInfo.data.user.registered.unixtime

        await redis.set(
            `rediscover:${user}:accountCreation`,
            String(unixtimeAccountCreation),
            'EX',
            60 * 60 * 24 * 10,
        )

        return userInfo.data.user.registered.unixtime
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
            return next(new Error('Last.FM user not found in session'))
        }
        const userAccountCreationUnixDate = Number(
            await userAccountCreation(userLastFm),
        )

        const comparisonFrom =
            req.body.comparisonFrom !== undefined
                ? dayjs(req.body.comparisonFrom as string).utc()
                : undefined

        const comparisonTo =
            req.body.comparisonTo !== undefined
                ? dayjs(req.body.comparisonTo as string).utc()
                : undefined

        const candidateFrom =
            req.body.candidateFrom !== undefined
                ? dayjs(req.body.candidateFrom as string).utc()
                : undefined

        const candidateTo =
            req.body.candidateTo !== undefined
                ? dayjs(req.body.candidateTo as string).utc()
                : undefined

        // se candidateFrom for ANTES da data de comparisonFrom, ERRO, por que dados candidatos a serem comparados devem ser procurados depois da data de comparisonFrom.
        if (candidateFrom?.isBefore(comparisonFrom)) {
            return next(
                new Error(
                    'invalid comparison period: Candidate period must start after the comparison period begins',
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
                    'Invalid comparison period: Comparison period must not overlap with the candidate period',
                ),
            )
        }

        // se comparisonFrom for DEPOIS da data comparisonTo, erro pois comparisonFrom deve ser uma data anterior a comparisonTo
        if (comparisonFrom?.isAfter(comparisonTo)) {
            return next(
                new Error(
                    "'Invalid comparison period: comparisonFrom' must be earlier than 'comparisonTo'",
                ),
            )
        }

        // se candidateFrom for DEPOIS de candidateTo, erro pois candidateFrom deve ser antes de candidateTo
        if (candidateFrom?.isAfter(candidateTo)) {
            return next(
                new Error(
                    "Invalid candidate period: 'candidateFrom' must be earlier than 'candidateTo'",
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
                    'Date parameters must be after account creation date',
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
            return next(new Error('Date parameters must not be in the future'))
        }


        next()
    } catch (error: unknown) {
        if (error instanceof Error) {
            return next(error)
        }

        return next(new Error('Unexpected error'))
    }
}
