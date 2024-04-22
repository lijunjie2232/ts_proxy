#!/usr/bin/env node

import { SocksServer } from './socks5Proxy/SocksServer';
import { HttpProxy } from './httpProxy/HttpProxy';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import { writeFileSync } from 'fs';
import { LogLevel, LogOutput, Logger } from './Logger'

/*const PORT = 1080; // Default SOCKS5 port
const CONFIG_PATH = "/home/ubuntu/ts_socks/socks-server-config.json"; // path to config file
*/

async function main() {
    try {

        const configPathIndex = process.argv.indexOf('--config_path');
        const configPath = configPathIndex > -1 ? process.argv[configPathIndex + 1] : path.join(__dirname, "../../server-config.json");

        const logLevelArgIndex = process.argv.indexOf('--log_level');
        const logLevelArg = logLevelArgIndex > -1 && logLevelArgIndex + 1 < process.argv.length ? process.argv[logLevelArgIndex + 1] : null;

        const logFilePathArgIndex = process.argv.indexOf('--log_file_path')
        const logFilePath = logFilePathArgIndex > -1 && logFilePathArgIndex + 1 < process.argv.length ? process.argv[logFilePathArgIndex + 1] : path.join(__dirname, '../../server.log');

        const logOutputArgIndex = process.argv.indexOf('--log_output')
        const logOutputArg = logOutputArgIndex > -1 && logOutputArgIndex + 1 < process.argv.length ? process.argv[logOutputArgIndex + 1] : null;

        const httpSupport = process.argv.includes('--http');

        const logLevel = logLevelArg && LogLevel[logLevelArg as keyof typeof LogLevel] ? LogLevel[logLevelArg as keyof typeof LogLevel] : LogLevel.Info;
        const logOutput = logOutputArg && LogOutput[logOutputArg as keyof typeof LogOutput] ? LogOutput[logOutputArg as keyof typeof LogOutput] : LogOutput.Console;

        const logger = new Logger(logLevel, logOutput, logFilePath);
        const socksServer = new SocksServer(configPath, logger);
        let httpProxy: HttpProxy;

        logger.debug(`Server Process PID : ${process.pid.toString()}`)

        console.log('Proxy server is starting...')

        // Start the server and listen for connections
        await socksServer.start();

        if (httpSupport) {
            //httpProxy = new HttpProxy(config, logger); // Corrected class name
            httpProxy = new HttpProxy(configPath, logger); 
            await httpProxy.start();
        };

        // Handle graceful shutdown
        const gracefulShutdown = async () => {
            console.log('Shutting down the server...');
            await socksServer.close();
            if (httpSupport) {
                await httpProxy.close();
            }
        };

        // Listen for shutdown signals
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);

    } catch (error) {
        console.error('Failed to start the server:', error);
        process.exit(1); // Exit with error code
    }
}

main();