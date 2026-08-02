/**
 * Error handling utilities
 */

import { logger } from './logger';

export interface AppError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: any;
}

/**
 * Extract user-friendly error message from error object
 */
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }
  
  return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
};

/**
 * Handle API errors and return user-friendly messages
 */
export const handleApiError = (error: unknown): string => {
  const message = getErrorMessage(error);
  
  // Log error for debugging
  logger.error('API Error:', error);
  
  // Map common error messages to user-friendly Arabic messages
  const errorMessages: Record<string, string> = {
    'Network request failed': 'فشل الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت.',
    'Failed to fetch': 'فشل الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت.',
    'Unauthorized': 'غير مصرح لك بالوصول. يرجى تسجيل الدخول مرة أخرى.',
    'Forbidden': 'غير مصرح لك بهذا الإجراء.',
    'Not Found': 'المورد المطلوب غير موجود.',
    'Internal Server Error': 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.',
    'Bad Request': 'البيانات المرسلة غير صحيحة. يرجى التحقق من المدخلات.',
    'Conflict': 'هذا السجل موجود بالفعل.',
    'Too Many Requests': 'تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً.',
    'quota': 'تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً أو ترقية الخطة.',
    'RESOURCE_EXHAUSTED': 'تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً أو ترقية الخطة.',
    'You exceeded your current quota': 'تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً أو ترقية الخطة.'
  };
  
  // Check if error message matches any known error
  for (const [key, value] of Object.entries(errorMessages)) {
    if (message.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  
  // Check for status code in error object
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as any).statusCode;
    switch (statusCode) {
      case 400:
        return 'البيانات المرسلة غير صحيحة. يرجى التحقق من المدخلات.';
      case 401:
        return 'غير مصرح لك بالوصول. يرجى تسجيل الدخول مرة أخرى.';
      case 403:
        return 'غير مصرح لك بهذا الإجراء.';
      case 404:
        return 'المورد المطلوب غير موجود.';
      case 409:
        return 'هذا السجل موجود بالفعل.';
      case 429:
        return 'تم تجاوز الحد المسموح به من الطلبات اليومية لخدمة الذكاء الاصطناعي. يرجى المحاولة لاحقاً أو ترقية الخطة.';
      case 500:
        return 'حدث خطأ في الخادم. يرجى المحاولة لاحقاً.';
      default:
        return message;
    }
  }
  
  return message;
};

/**
 * Create a standardized error object
 */
export const createAppError = (
  message: string,
  code?: string,
  statusCode?: number,
  details?: any
): AppError => {
  return {
    message,
    code,
    statusCode,
    details
  };
};

/**
 * Check if error is a network error
 */
export const isNetworkError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('network') || 
         message.includes('fetch') || 
         message.includes('connection') ||
         message.includes('timeout');
};

/**
 * Check if error is an authentication error
 */
export const isAuthError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('unauthorized') || 
         message.includes('forbidden') ||
         message.includes('authentication') ||
         message.includes('token');
};

