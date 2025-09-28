import { Request, Response, NextFunction } from 'express';

export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {
    console.error('Error occurred:', {
        message: error.message,
        stack: error.stack,
        method: req.method,
        url: req.url,
        body: req.body,
        timestamp: new Date().toISOString()
    });

    // Don't expose internal errors in production
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (error.name === 'AirtableError') {
        return res.status(400).json({
            success: false,
            error: 'Database operation failed',
            message: isDevelopment ? error.message : 'Database error occurred'
        });
    }

    if (error.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Invalid request data',
            message: error.message
        });
    }

    // Default server error
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: isDevelopment ? error.message : 'Something went wrong'
    });
}