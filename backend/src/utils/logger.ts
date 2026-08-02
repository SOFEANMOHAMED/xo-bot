import fs from 'fs';
import path from 'path';

// Log levels
enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  context?: Record<string, any>;
}

class Logger {
  private logDir: string;
  private isDevelopment: boolean;

  constructor() {
    this.logDir = process.env.LOG_DIR || 'logs';
    this.isDevelopment = process.env.NODE_ENV === 'development';

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatMessage(level: LogLevel, message: string, error?: Error, context?: Record<string, any>): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context })
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    return entry;
  }

  private writeLog(entry: LogEntry) {
    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
    const logLine = JSON.stringify(entry) + '\n';

    // Write to file asynchronously
    fs.appendFile(logFile, logLine, (err) => {
      if (err) {
        console.error('Failed to write to log file:', err);
      }
    });

    // Also log to console in development
    if (this.isDevelopment) {
      const colorMap: Record<LogLevel, string> = {
        [LogLevel.ERROR]: '\x1b[31m', // Red
        [LogLevel.WARN]: '\x1b[33m',  // Yellow
        [LogLevel.INFO]: '\x1b[36m',  // Cyan
        [LogLevel.DEBUG]: '\x1b[90m'  // Gray
      };
      const reset = '\x1b[0m';
      const color = colorMap[entry.level] || '';
      
      console.log(
        `${color}[${entry.timestamp}] ${entry.level}${reset} ${entry.message}`,
        entry.error ? `\n${entry.error.stack}` : '',
        entry.context ? `\nContext: ${JSON.stringify(entry.context, null, 2)}` : ''
      );
    }
  }

  error(message: string, error?: Error, context?: Record<string, any>) {
    this.writeLog(this.formatMessage(LogLevel.ERROR, message, error, context));
  }

  warn(message: string, context?: Record<string, any>) {
    this.writeLog(this.formatMessage(LogLevel.WARN, message, undefined, context));
  }

  info(message: string, context?: Record<string, any>) {
    this.writeLog(this.formatMessage(LogLevel.INFO, message, undefined, context));
  }

  debug(message: string, context?: Record<string, any>) {
    if (this.isDevelopment) {
      this.writeLog(this.formatMessage(LogLevel.DEBUG, message, undefined, context));
    }
  }
}

export const logger = new Logger();

