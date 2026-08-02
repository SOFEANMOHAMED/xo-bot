/**
 * Logger utility
 * Only logs in development mode
 */
const isDevelopment = import.meta.env?.MODE === 'development' ||
    import.meta.env?.DEV === true ||
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');
export const logger = {
    log: (...args) => {
        if (isDevelopment) {
            console.log(...args);
        }
    },
    error: (...args) => {
        // Always log errors, but in production send to error tracking service
        if (isDevelopment) {
            console.error('❌', ...args);
        }
        else {
            // In production, you can send to error tracking service (Sentry, etc.)
            // Example: Sentry.captureException(new Error(args.join(' ')));
            console.error('❌', ...args); // Keep for now, but can be replaced with error service
        }
    },
    warn: (...args) => {
        if (isDevelopment) {
            console.warn(...args);
        }
    },
    info: (...args) => {
        if (isDevelopment) {
            console.info(...args);
        }
    }
};
//# sourceMappingURL=logger.js.map