import winston from 'winston';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? '\n' + JSON.stringify(meta, null, 2)
      : '';
    return `${timestamp} [${level}] ${message}${stack ? '\n' + stack : ''}${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: isDev ? devFormat : prodFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 20 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' }),
  ],
});
