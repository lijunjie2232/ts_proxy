import * as fs from 'fs';
import * as path from 'path';

enum LogLevel {
    Debug = 'debug',
    Info = 'info',
    Warn = 'warn',
    Error = 'error',
    None = 'none'
}

enum LogOutput {
    Console = 'console',
    File = 'file',
    Both = 'both'
}

class Logger {
    level: LogLevel;
    output: LogOutput;
    logFilePath: string;

    constructor(level: LogLevel, output: LogOutput, logFilePath: string) {
        this.level = level;
        this.output = output;
        this.logFilePath = logFilePath;
    }

    private shouldLog(level: LogLevel): boolean {
        if (this.level === LogLevel.None) {
            return false;
        }
        const levels = [LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }

    private logToFile(message: string) {
        fs.appendFile(this.logFilePath, message + '\n', err => {
            if (err) {
                console.error('Error writing to log file:', err);
            }
        });
    }

    private logMessage(level: string, message: string, ...optionalParams: any[]) {
        const formattedMessage = `[${level.toUpperCase()}] ${new Date().toISOString()} - ${message}`;

        if (this.output === LogOutput.Console || this.output === LogOutput.Both) {
            console.log(formattedMessage, ...optionalParams);
        }

        if (this.output === LogOutput.File || this.output === LogOutput.Both) {
            this.logToFile(formattedMessage + ' ' + optionalParams.join(' '));
        }
    }

    debug(message: string, ...optionalParams: any[]) {
        if (this.shouldLog(LogLevel.Debug)) {
            this.logMessage(LogLevel.Debug, message, ...optionalParams);
        }
    }

    info(message: string, ...optionalParams: any[]) {
        if (this.shouldLog(LogLevel.Info)) {
            this.logMessage(LogLevel.Info, message, ...optionalParams);
        }
    }

    warn(message: string, ...optionalParams: any[]) {
        if (this.shouldLog(LogLevel.Warn)) {
            this.logMessage(LogLevel.Warn, message, ...optionalParams);
        }
    }

    error(message: string, ...optionalParams: any[]) {
        if (this.shouldLog(LogLevel.Error)) {
            this.logMessage(LogLevel.Error, message, ...optionalParams);
        }
    }
}

export { LogLevel, LogOutput, Logger };
