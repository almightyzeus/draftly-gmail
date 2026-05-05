/**
 * Custom error class with HTTP status code
 */
export class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.name = 'AppError';
    }
}
/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
        this.name = 'ValidationError';
    }
}
/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401);
        this.name = 'UnauthorizedError';
    }
}
/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(message, 403);
        this.name = 'ForbiddenError';
    }
}
/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}
/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(message, 409);
        this.name = 'ConflictError';
    }
}
/**
 * Internal server error (500)
 */
export class InternalServerError extends AppError {
    constructor(message = 'Internal server error') {
        super(message, 500);
        this.name = 'InternalServerError';
    }
}
