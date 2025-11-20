"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = require("../utils/logger");
const types_1 = require("../types");
const errorHandler = (error, req, res, _next) => {
    let statusCode = 500;
    let message = 'Internal server error';
    if (error instanceof types_1.AppError) {
        statusCode = error.statusCode;
        message = error.message;
    }
    else if (error.name === 'ValidationError') {
        statusCode = 400;
        message = error.message;
    }
    else if (error.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
    }
    else if (error.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
    }
    else if (error.name === 'PrismaClientKnownRequestError') {
        statusCode = 400;
        message = 'Database operation failed';
    }
    if (statusCode >= 500) {
        logger_1.logger.error('Server error:', {
            error: error.message,
            stack: error.stack,
            url: req.url,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
        });
    }
    else {
        logger_1.logger.warn('Client error:', {
            error: error.message,
            url: req.url,
            method: req.method,
            ip: req.ip,
            statusCode,
        });
    }
    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && {
            stack: error.stack,
            details: error.message,
        }),
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map