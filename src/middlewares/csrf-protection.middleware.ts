import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// Gera um token CSRF (use no login)
export const generateCsrfToken = (): string => {
    return crypto.randomBytes(32).toString("hex");
};

// Middleware de proteção CSRF
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
    const dangerousMethods = ["POST", "PUT", "PATCH", "DELETE"];

    // if (process.env.NODE_ENV !== "test") {
    //     return next()
    // }

    if (!dangerousMethods.includes(req.method)) {
        return next();
    }

    const csrfCookie = req.cookies?.csrf_token;
    const csrfHeader = req.headers["x-csrf-token"];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return res.status(403).json({
            error: "Invalid CSRF token",
            message: "Possible CSRF attack detected"
        });
    }

    next();
};