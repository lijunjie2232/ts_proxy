import * as net from 'net';
import { SocksSession } from './SocksSession';
import { Logger } from '../Logger';
import { ConfigManager } from '../ConfigManager';


export class SocksServer {
    private server: net.Server;
    public configManager: ConfigManager;
    private activeConnections: Set<net.Socket>;
    private logger: Logger;
    private failedAuthAttempts: Map<string, number>;

    constructor(configPath: string, logger: Logger) {
        this.configManager = new ConfigManager(configPath);
        this.server = new net.Server();
        this.activeConnections = new Set();
        this.logger = logger;
        this.failedAuthAttempts = new Map<string, number>();
        
        this.server.on('connection', this.handleConnection.bind(this));
        this.server.on('error', (err) => {
            this.logger.error(`Server error: ${err.message}`);
        });
    }

    private handleConnection(socket: net.Socket) {;
        const clientIP = socket.remoteAddress || ''
        this.logger.info(`New connection on server from socket : ${socket.remoteAddress}:${socket.remotePort}`)

        // Check if the server has reached its maximum number of concurrent connections
        if (this.activeConnections.size >= this.configManager.config.server.maxConcurrentConnections) {
            this.logger.info(`Connection limit reached. Rejecting new connection from ${clientIP}`);
            socket.destroy();
            return;
        }

        if (this.configManager.config.clientIpFiltering.blacklist.includes(clientIP)) {
            this.logger.info(`Rejected blacklisted IP: ${clientIP}`);
            socket.destroy();
            return;
        }

        if (!this.isWhitelistedIP(clientIP)) {
            this.logger.info(`Client not in the whitelist: ${clientIP}`);
            socket.destroy();
            return;
        }

        this.activeConnections.add(socket);
        socket.on('close', () => {
            this.logger.info(`Connection closed from socket : ${socket.remoteAddress}:${socket.remotePort}`)
            this.activeConnections.delete(socket)
        });
        new SocksSession(socket, this.configManager, this.logger, this.incrementAuthFailure.bind(this));  // Assuming this handles the individual connection
    }

    private isWhitelistedIP(ip: string | undefined | null): boolean {
        const whitelist = this.configManager.config.clientIpFiltering.whitelist;
        // If the whitelist is undefined or empty, return true
        if (!whitelist || whitelist.length === 0) {
            return true;
        }
        // Otherwise, check if the IP is in the whitelist
        return whitelist.includes(ip || '');
    }


    private incrementAuthFailure(clientIP: string) {
        const attempts = (this.failedAuthAttempts.get(clientIP) || 0) + 1;
        this.failedAuthAttempts.set(clientIP, attempts);

        if (attempts >= this.configManager.config.authentication.maxFailedAttempts) {
            this.logger.info(`Blacklisting IP due to too many failed attempts: ${clientIP}`);
            this.configManager.config.clientIpFiltering.blacklist.push(clientIP);
        }
    }

    public async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(this.configManager.config.server.socks5.port, this.configManager.config.server.socks5.serverIP, () => {
                this.logger.info(`SOCKS5 server listening on ${this.configManager.config.server.socks5.serverIP}:${this.configManager.config.server.socks5.port}`);
                resolve();
            });

            // Handle potential server start errors
            this.server.on('error', (error) => {
                this.logger.error(`Error starting SOCKS5 server: ${error}`);
                reject(error);
            });
        });
    }

    public async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Ensure all connections are terminated
            for (const socket of this.activeConnections) {
                socket.destroy();
            }
            this.activeConnections.clear();
            this.logger.info(`Closed active connections`);

            // Close the server
            this.server.close((error) => {
                if (error) {
                    this.logger.error(`Error closing SOCKS5 server: ${error}`);
                    reject(error);
                } else {
                    this.logger.info(`Closing the server...`);
                    resolve();
                }
            });
        });
    }
}