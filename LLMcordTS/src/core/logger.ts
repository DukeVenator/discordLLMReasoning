// LLMcordTS/src/core/logger.ts
import pino, { LoggerOptions, Logger as PinoLogger, LevelWithSilent } from 'pino'; // Correct import for LevelWithSilent

// Basic configuration (can be expanded later)
const defaultLogLevel: LevelWithSilent = 'info';

export interface LoggerContext {
    name?: string;
    messageId?: string; // Optional: Discord message ID
    userId?: string;    // Optional: Discord user ID
    channelId?: string; // Optional: Discord channel ID
    // Add other context fields as needed
}

export class Logger {
    private pinoLogger: PinoLogger; // Reverted to private
    private context: LoggerContext;

    // Private constructor to enforce use of factory method
    private constructor(options: LoggerOptions, context: LoggerContext = {}) {
        // Ensure options are passed correctly
        this.pinoLogger = pino(options);
        this.context = context;
    }

    // Factory method to create the root logger
    public static createRootLogger(level: LevelWithSilent = defaultLogLevel): Logger {
        const options: LoggerOptions = {
            level: level,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname', // Don't log pid and hostname
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', // Human-readable time
                },
            },
            // Add name to root logger options
            name: 'Root',
        };
        // Pass context { name: 'Root' } to constructor
        return new Logger(options, { name: 'Root' });
    }

    // Method to create sub-loggers with inherited context/config
    public getSubLogger(context: LoggerContext): Logger {
        const subLoggerContext = { ...this.context, ...context };
        // Create new options for the sub-logger, inheriting the level
        const subLoggerOptions: LoggerOptions = {
            level: this.pinoLogger.level, // Inherit level
            // Re-apply transport options for consistent formatting
             transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    ignore: 'pid,hostname',
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                },
            },
            // Set the name for the sub-logger, providing a default if undefined
            name: subLoggerContext.name ?? 'SubLogger', // Provide default name
        };

        // Create a new Logger wrapper instance with the new options
        const subLogger = new Logger(subLoggerOptions, subLoggerContext);

        return subLogger;
    }

    // Logging methods
    public trace(message: string, ...args: any[]): void {
        // Pass context as the first argument to pino methods if needed, or rely on bound context
        this.pinoLogger.trace(this.context, message, ...args);
    }

    public debug(message: string, ...args: any[]): void {
        this.pinoLogger.debug(this.context, message, ...args);
    }

    public info(message: string, ...args: any[]): void {
        this.pinoLogger.info(this.context, message, ...args);
    }

    public warn(message: string, ...args: any[]): void {
        this.pinoLogger.warn(this.context, message, ...args);
    }

    public error(message: string, ...args: any[]): void {
        // Ensure Error objects are logged correctly
        const logArgs = args.map(arg => arg instanceof Error ? arg : arg);
        this.pinoLogger.error(this.context, message, ...logArgs);
    }

    public fatal(message: string, ...args: any[]): void {
        const logArgs = args.map(arg => arg instanceof Error ? arg : arg);
        this.pinoLogger.fatal(this.context, message, ...logArgs);
    }

    // Method to update log level dynamically if needed
    public setLevel(level: LevelWithSilent): void { // Use correct type
        this.pinoLogger.level = level;
    }

    // Method to get the current log level
    public getLevel(): LevelWithSilent { // Use correct type
        // Cast as we assume standard levels are used based on setLevel type
        return this.pinoLogger.level as LevelWithSilent;
    }
}

// Optional: Export a default root logger instance
export const logger = Logger.createRootLogger();