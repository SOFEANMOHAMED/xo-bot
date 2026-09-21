import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const NODE_ENV_TEST = 'test';
const PRODUCTION_LOG_DIR_NAME = 'logs';
const TEST_LOG_DIR_NAME = 'logs-test';
const DEFAULT_RETENTION_DAYS = 14;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DAILY_LOG_NAME = /^\d{4}-\d{2}-\d{2}\.log$/;

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LOG_RETENTION_DAYS = Math.max(
  1,
  Number.parseInt(process.env.LOG_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10) || DEFAULT_RETENTION_DAYS,
);

enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  context?: Record<string, unknown>;
}

export function productionLogDir(root: string = backendRoot): string {
  return path.resolve(root, PRODUCTION_LOG_DIR_NAME);
}

export function defaultTestLogDir(root: string = backendRoot): string {
  return path.resolve(root, TEST_LOG_DIR_NAME);
}

export function isSameDir(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export function isProductionLogDir(dir: string, root: string = backendRoot): boolean {
  return isSameDir(dir, productionLogDir(root)) || isSameDir(dir, PRODUCTION_LOG_DIR_NAME);
}

export function resolveLoggerDir(options?: {
  nodeEnv?: string;
  logDir?: string;
  backendRoot?: string;
}): string {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  const fromEnv = (options?.logDir ?? process.env.LOG_DIR ?? '').trim();
  const root = options?.backendRoot ?? backendRoot;
  if (nodeEnv === NODE_ENV_TEST) {
    if (fromEnv && !isProductionLogDir(fromEnv, root)) {
      return path.resolve(fromEnv);
    }
    return defaultTestLogDir(root);
  }
  return fromEnv || PRODUCTION_LOG_DIR_NAME;
}

/**
 * Delete YYYY-MM-DD.log files older than retention in logDir.
 * Never reads, writes, or unlinks the production log directory.
 */
export function pruneOldLogs(
  logDir: string,
  options?: {
    backendRoot?: string;
    nowMs?: number;
    retentionDays?: number;
  },
): void {
  const root = options?.backendRoot ?? backendRoot;
  if (isProductionLogDir(logDir, root)) {
    return;
  }
  const nowMs = options?.nowMs ?? Date.now();
  const retentionDays = options?.retentionDays ?? LOG_RETENTION_DAYS;
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  let names: string[];
  try {
    names = fs.readdirSync(logDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!DAILY_LOG_NAME.test(name)) {
      continue;
    }
    const full = path.join(logDir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      // skip undeletable files
    }
  }
}

function fileOutputBlocked(logDir: string): boolean {
  return process.env.NODE_ENV === NODE_ENV_TEST && isProductionLogDir(logDir);
}

class Logger {
  private logDir: string;
  private isDevelopment: boolean;
  private lastPruneAt = 0;

  constructor() {
    this.logDir = resolveLoggerDir();
    this.isDevelopment = process.env.NODE_ENV === 'development';
    if (fileOutputBlocked(this.logDir)) {
      return;
    }
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.maybePrune();
  }

  private maybePrune(): void {
    if (fileOutputBlocked(this.logDir)) {
      return;
    }
    const now = Date.now();
    if (this.lastPruneAt && now - this.lastPruneAt < PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastPruneAt = now;
    pruneOldLogs(this.logDir);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    };
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return entry;
  }

  private writeLog(entry: LogEntry): void {
    if (fileOutputBlocked(this.logDir)) {
      return;
    }
    this.maybePrune();
    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFile(logFile, logLine, (err) => {
      if (err) {
        console.error('Failed to write to log file:', err);
      }
    });
    if (this.isDevelopment) {
      const colorMap: Record<LogLevel, string> = {
        [LogLevel.ERROR]: '\x1b[31m',
        [LogLevel.WARN]: '\x1b[33m',
        [LogLevel.INFO]: '\x1b[36m',
        [LogLevel.DEBUG]: '\x1b[90m',
      };
      const reset = '\x1b[0m';
      const color = colorMap[entry.level] || '';
      console.log(
        `${color}[${entry.timestamp}] ${entry.level}${reset} ${entry.message}`,
        entry.error ? `\n${entry.error.stack}` : '',
        entry.context ? `\nContext: ${JSON.stringify(entry.context, null, 2)}` : '',
      );
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.writeLog(this.formatMessage(LogLevel.ERROR, message, error, context));
  }

  warn(message: string, contextOrError?: Record<string, unknown> | Error): void {
    if (contextOrError instanceof Error) {
      this.writeLog(this.formatMessage(LogLevel.WARN, message, contextOrError));
      return;
    }
    this.writeLog(this.formatMessage(LogLevel.WARN, message, undefined, contextOrError));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.writeLog(this.formatMessage(LogLevel.INFO, message, undefined, context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.isDevelopment) {
      this.writeLog(this.formatMessage(LogLevel.DEBUG, message, undefined, context));
    }
  }
}

export const logger = new Logger();
