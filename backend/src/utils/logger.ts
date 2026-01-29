import winston from 'winston';

/**
 * Production-ready logger using Winston
 * 
 * Features:
 * - Structured JSON logging for production
 * - Pretty console output for development
 * - Log levels: error, warn, info, http, debug
 * - Automatic timestamp and metadata
 */

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// Custom format for development (human-readable)
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata, null, 2)}`;
  }
  
  return msg;
});

// Determine log level from environment
const getLogLevel = (): string => {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && ['error', 'warn', 'info', 'http', 'debug'].includes(level)) {
    return level;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

// Determine format based on environment
const getFormat = () => {
  const isPretty = process.env.LOG_FORMAT === 'pretty' || process.env.NODE_ENV !== 'production';
  
  if (isPretty) {
    return combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      devFormat
    );
  }
  
  // JSON format for production (easier to parse in log aggregators)
  return combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    errors({ stack: true }),
    json()
  );
};

// Create the logger instance
export const logger = winston.createLogger({
  level: getLogLevel(),
  format: getFormat(),
  defaultMeta: { service: 'sheets-mysql-sync' },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

// Export a function to update log level at runtime
export const setLogLevel = (level: string): void => {
  logger.level = level;
};

// Export log level constants for TypeScript usage
export const LogLevels = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  HTTP: 'http',
  DEBUG: 'debug',
} as const;
