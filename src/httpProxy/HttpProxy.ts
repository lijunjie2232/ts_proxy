import * as http from 'http';
import * as net from 'net';
import { Logger } from '../Logger';
import { IAuthMethod, UserPassAuth } from '../Auth';
import { SessionMonitor } from '../SessionMonitor';
import { HttpSession, HttpsSession } from './HttpSession'
import { ConfigManager } from '../ConfigManager';

export class HttpProxy {
    private httpServer: http.Server;
    public configManager: ConfigManager;
    private logger: Logger;
    private authHandler: IAuthMethod | null;
    private failedAuthAttempts: Map<string, number>;
    private activeConnections: Map<net.Socket, SessionMonitor>;

    constructor(configPath: string, logger: Logger) {
        this.configManager = new ConfigManager(configPath);
        this.logger = logger;
        this.failedAuthAttempts = new Map<string, number>();
        this.activeConnections = new Map<net.Socket, SessionMonitor>();

        if (this.configManager.config.authentication.method === 'password') {
            this.authHandler = new UserPassAuth(this.configManager.config.credentials);
        } else {
            this.authHandler = null;
        }

        this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
        this.httpServer.on('connect', (req, socket, head) => this.handleHttpsRequest(req, socket as net.Socket, head));

        // Listener for the 'connection' event to manage the active connections
        this.httpServer.on('connection', (socket) => {
            if (this.activeConnections.size >= this.configManager.config.server.maxConcurrentConnections) {
                this.logger.info(`Maximum concurrent sessions reached (${this.configManager.config.server.maxConcurrentConnections}). Rejecting new connection.`);
                socket.destroy();
            } else {
                this.logger.info(`New connection from ${socket.remoteAddress}:${socket.remotePort}`)
                const sessionMonitor = new SessionMonitor(socket); // Create a new SessionMonitor for this connection
                this.activeConnections.set(socket, sessionMonitor); // Store the socket and its SessionMonitor

                socket.on('close', () => {
                    this.logger.info(`Closing connection for ${socket.remoteAddress}:${socket.remotePort}`)
                    this.activeConnections.delete(socket); // Remove from the map when the socket closes
                });
            }
        });
    }

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        this.logger.debug(`Receveid HTTP request`)
        this.logger.debug(`Remote server ${req.url}`)


        console.log(this.configManager.config.clientIpFiltering.whitelist)
        console.log(this.configManager.config.clientIpFiltering.blacklist)
        console.log(this.configManager.config.serverIpFiltering.whitelist)
        console.log(this.configManager.config.serverIpFiltering.blacklist)

        try {
            if (!req.url) {
                this.logger.error('Malformed HTTP request: Missing URL');
                res.writeHead(400, 'Bad Request');
                res.end('Bad Request: Missing URL');
                return;
            }

            const targetHost = new URL(req.url).hostname;

            if (!targetHost) {
                this.logger.error(`Malformed HTTP request: Invalid URL - ${req.url}`);
                res.writeHead(400, 'Bad Request');
                res.end('Bad Request: Invalid URL');
                return;
            }

            if (this.isBlockedIP(req.socket.remoteAddress)) {
                this.logger.info(`Rejected blacklisted IP: ${req.socket.remoteAddress}`);
                res.writeHead(403);
                res.end('Access Denied');
                return;
            }

            if (!this.isWhitelistedIP(req.socket.remoteAddress)) {
                this.logger.info(`IP not whitelisted: ${req.socket.remoteAddress}`);
                res.writeHead(403);
                res.end('Access Denied');
                return;
            }

            if (!await this.authenticate(req)) {
                res.writeHead(401);
                res.end('Unauthorized');
                return;
            }

            if (await this.isBlockedServer(targetHost)) {
                res.writeHead(403);
                res.end('Access to the requested URL is blocked');
                this.logger.info(`Rejected target IP: ${targetHost}`);
                return;
            }

            if (await !this.isWhitelistedServer(targetHost)) {
                res.writeHead(403);
                res.end('Access to the requested URL is not allowed');
                this.logger.info(`Rejected target IP: ${targetHost}`);
                return;
            }

            this.logger.debug(`Is Blocked : ${await this.isBlockedServer(targetHost)}`)
        
            const httpSession = new HttpSession(req, res, this.logger, this.configManager);
            this.logger.debug(`No error in instantiation of httpSession`)
            httpSession.processRequest();

        } catch (error) {
            this.logger.error(`Error handling HTTP request: ${error}`);
            res.writeHead(500, 'Internal Server Error');
            res.end('Internal Server Error');
        }
    }

    private async handleHttpsRequest(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
        this.logger.debug(`Received HTTPS request`);
        this.logger.debug(`Received HTTPS header: ${head}`);
        this.logger.debug(`Remote server URL: ${req.url}`);
        
        try {
            if (!req.url) {
                this.logger.error('Malformed HTTPS request: Missing URL');
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return;
            }

            let targetHost, targetPort;

            [targetHost, targetPort] = req.url.split(':');
            targetPort = targetPort || '443';

            if (!targetHost) {
                this.logger.error(`Malformed HTTPS request: Invalid URL - ${req.url}`);
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return;
            }

            this.logger.info(`Parsed target host: ${targetHost}, Port: ${targetPort}`);


            if (this.isBlockedIP(socket.remoteAddress)) {
                this.logger.info(`Rejected blacklisted IP: ${socket.remoteAddress}`);
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            if (!await this.authenticate(req)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            if (await this.isBlockedServer(targetHost)) {
                this.logger.info(`Access to the requested URL is blocked: ${targetHost}`);
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            const httpsSession = new HttpsSession(req, socket, head, this.logger, this.configManager);
            httpsSession.processRequest();

        } catch (error) {
            this.logger.error(`Error handling HTTPS request: ${error}`);
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            socket.destroy();
        }
    }

    private isBlockedServer(hostname: string): boolean {
        return this.configManager.config.serverIpFiltering.blacklist.includes(hostname.replace(/[\[\]]/g, '').replace(/^www\./, ''));
    }

    private isWhitelistedServer(hostname: string): boolean {
        const whitelist = this.configManager.config.serverIpFiltering.whitelist;
        if (!whitelist || whitelist.length === 0) {
            return true;
        }
        return whitelist.includes(hostname);
    }

    private isBlockedIP(ip: string | undefined | null): boolean {
        return this.configManager.config.clientIpFiltering.blacklist.includes(ip || '');
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

    private async authenticate(req: http.IncomingMessage): Promise<boolean> {
        try {
            const clientIP = req.socket.remoteAddress || '';
            let isAuthenticated = false;

            if (this.authHandler) {
                isAuthenticated = await this.authHandler.authenticate('http', { headers: req.headers });

                if (!isAuthenticated) {
                    this.incrementAuthFailure(clientIP);
                }
            } else {
                isAuthenticated = true;
            }

            return isAuthenticated;

        } catch (error) {
            this.logger.error(`Authentication error: ${error}`);
            return false;
        }
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
            this.httpServer.listen(this.configManager.config.server.http.port, this.configManager.config.server.http.serverIP, () => {
                this.logger.info(`HTTP/HTTPS proxy server listening on ${this.configManager.config.server.http.serverIP}:${this.configManager.config.server.http.port}`);
                resolve();
            });

            // Handle potential errors
            this.httpServer.on('error', (error) => {
                this.logger.error(`Error starting HTTP/HTTPS proxy server: ${error}`);
                reject(error);
            });
        });
    }

    public async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Ensure all connections are terminated
            this.activeConnections.forEach((sessionMonitor, socket) => {
                socket.destroy();
            });
            this.activeConnections.clear();
            this.logger.info(`Closed active connections`);

            // Close the HTTP server
            this.httpServer.close((error) => {
                if (error) {
                    this.logger.error(`Error closing HTTP/HTTPS proxy server: ${error}`);
                    reject(error);
                } else {
                    this.logger.info(`Closing the server...`);
                    resolve();
                }
            });
        });
    }
}
