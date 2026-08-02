import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  code?: string;
}

export const createError = (
  message: string,
  statusCode: number = 500,
  isOperational: boolean = true,
  code?: string
): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = isOperational;
  error.code = code;
  return error;
};

export const errorHandler = (
  err: AppError | Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = (err as AppError).statusCode || 500;
  const isOperational = (err as AppError).isOperational !== false;
  const errorCode = (err as AppError).code;

  // Log error with context
  const errorContext = {
    statusCode,
    path: req.path,
    method: req.method,
    query: req.query,
    body: req.body,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    isOperational,
    code: errorCode
  };

  if (statusCode >= 500) {
    logger.error('Server Error', err as Error, errorContext);
  } else if (statusCode >= 400) {
    logger.warn('Client Error', errorContext);
  } else {
    logger.info('Error Handled', errorContext);
  }

  // Don't leak error details in production for non-operational errors
  const shouldHideDetails = !isOperational && process.env.NODE_ENV === 'production';

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message: shouldHideDetails ? 'Internal server error' : err.message,
      code: errorCode,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: errorContext
      })
    }
  });
};
