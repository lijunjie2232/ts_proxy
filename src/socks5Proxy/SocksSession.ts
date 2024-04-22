import * as net from 'net';
import { parseDestination, sendReply } from '../utils';
import { IAuthMethod, UserPassAuth } from '../Auth';
import { ConnectCommandHandler } from './ConnectCommandHandler';
import { BindCommandHandler } from './BindCommandHandler';
import { UdpAssociateHandler } from './UDPAssociateCommandHandler';
import { CommandHandler } from './CommandHandler';
import { Logger } from '../Logger'
import { SessionMonitor } from '../SessionMonitor'
import { ConfigManager } from '../ConfigManager';

enum SocksSessionState {
    AwaitingGreeting,
    AwaitingAuthentication,
    AwaitingInitialCommand,
    DataRelayMode
}

export class SocksSession {
    private state: SocksSessionState = SocksSessionState.AwaitingGreeting;
    private isGreetingHandled: boolean = false;
    private configManager: ConfigManager;
    private authHandler: IAuthMethod | null;
    private static usedUdpPorts = new Set<number>();
    private udpPort: number;
    private logger: Logger;
    private commandHandler: CommandHandler | undefined;
    private incrementAuthFailure: (clientIP: string) => void;
    private monitor: SessionMonitor;

    constructor(private clientSocket: net.Socket, configManager: ConfigManager, logger: Logger, incrementAuthFailure: (clientIP: string) => void) {
        this.configManager = configManager;
        this.logger = logger;
        this.incrementAuthFailure = incrementAuthFailure;
        this.monitor = new SessionMonitor(clientSocket);

        this.logger.info(`Initialize new session`);

        // Instantiate the appropriate authentication handler
        if (this.configManager.config.authentication.method === 'password') {
            this.authHandler = new UserPassAuth(this.configManager.config.credentials);
        } else {
            this.authHandler = null;
        }

        this.sessionCleanup = this.sessionCleanup.bind(this);

        this.clientSocket = clientSocket;
        this.udpPort = this.assignUdpPort();
        this.logger.info(`UDP port assigned : ${this.udpPort}`);

        this.clientSocket.on('data', this.handleData);
        this.clientSocket.on('close', this.sessionCleanup);
        this.clientSocket.on('error', this.sessionCleanup);
    }

    private handleData = async (data: Buffer) => {
        this.logger.debug(`Received data : `, data);

        switch (this.state) {
            case SocksSessionState.AwaitingGreeting:
                this.handleGreeting(data);
                break
            case SocksSessionState.AwaitingAuthentication:
                await this.handleAuth(data);
                break;
            case SocksSessionState.AwaitingInitialCommand:
                this.handleCommand(data);
                break;
            case SocksSessionState.DataRelayMode:
                break;
        }
    }

    private handleGreeting(data: Buffer) {
        const version = data[0];
        const nMethods = data[1];
        const methods = data.slice(2, 2 + nMethods);

        if (version !== 0x05) {
            // Unsupported SOCKS protocol version
            this.clientSocket.end();
            return;
        }

        if (methods.includes(0x02) && this.authHandler instanceof UserPassAuth) { // user/pass auth
            this.clientSocket.write(Buffer.from([0x05, 0x02]));
            this.isGreetingHandled = true;
            this.logger.info(`Successfull greeting`);
        } else if (methods.includes(0x00 && this.authHandler === null)) { // No Authentication Required
            this.clientSocket.write(Buffer.from([0x05, 0x00]));
            this.isGreetingHandled = true;
            this.logger.info(`Successfull greeting`);
        } else {
            // No acceptable methods
            this.clientSocket.write(Buffer.from([0x05, 0xff]));
            this.clientSocket.end();
        }

        this.state = this.authHandler ? SocksSessionState.AwaitingAuthentication : SocksSessionState.AwaitingInitialCommand;
    }

    private async handleAuth(data: Buffer) {
        const clientIP = this.clientSocket.remoteAddress || '';
        let isAuthenticated
        if (this.authHandler) {
            isAuthenticated = await this.authHandler.authenticate('socks5', {socket: this.clientSocket, data: data});
            if (isAuthenticated) {
                this.logger.info(`Successful authentication`);
                const response = Buffer.from([0x05, 0x00]); // Success
                this.clientSocket.write(response);
                this.authHandler = null; // Authentication complete, no longer needed
            } else {
                this.incrementAuthFailure(clientIP);
                const response = Buffer.from([0x05, 0x01]); // Failure
                this.logger.info(`Failed authentication`);
                this.clientSocket.write(response);
                this.clientSocket.end(); // Close the connection on authentication failure
            }

        } else {
            isAuthenticated = true;
            const response = Buffer.from([0x05, 0x00]); // Success
            this.clientSocket.write(response);          
        }
            // After successful authentication, transition to awaiting initial command state
        if (isAuthenticated) {
            this.state = SocksSessionState.AwaitingInitialCommand;
        }          
    } 

    private handleCommand(data: Buffer) {
        const { host, port } = parseDestination(data);
        this.filterAccess(host, () => {
            const command = data[1];
            switch (command) {
                case 0x01: // CONNECT
                    this.logger.info(`CONNECT command received`);
                    this.commandHandler = new ConnectCommandHandler(this.clientSocket, data, this.configManager, this.logger);
                    this.state = SocksSessionState.DataRelayMode;
                    break;
                case 0x02: // BIND
                    this.logger.info(`BIND command received`);
                    this.commandHandler = new BindCommandHandler(this.clientSocket, data, this.configManager, this.logger);
                    this.state = SocksSessionState.DataRelayMode;
                    break;
                case 0x03: // UDP ASSOCIATE
                    this.logger.info(`UDP ASSOCIATE command received`);
                    this.commandHandler = new UdpAssociateHandler(this.clientSocket, data, this.configManager, this.udpPort, this.logger);
                    this.state = SocksSessionState.DataRelayMode;
                    break;
            }
        })
    }

    private filterAccess(host: string, onSuccess: () => void) {
        if (this.isBlockedIP(host)) {
            this.logger.info(`Access to IP ${host} blocked by server policy`);
            this.clientSocket.end();
            return;
        }

        if (!this.isWhitelistedIP(host)) {
            this.logger.info(`Access to IP ${host} not allowed by server policy`);
            this.clientSocket.end();
            return;
        }

        onSuccess();
    }

    private isWhitelistedIP(hostname: string): boolean {
        const whitelist = this.configManager.config.serverIpFiltering.whitelist;
        if (!whitelist || whitelist.length === 0) {
            return true;
        }
        return whitelist.includes(hostname);
    }

    private isBlockedIP(ip: string): boolean {
        return this.configManager.config.serverIpFiltering.blacklist.includes(ip);
    }

    private assignUdpPort(): number {
        for (let port = this.configManager.config.server.socks5.udpPortRange.min; port <= this.configManager.config.server.socks5.udpPortRange.max; port++) {
            if (!SocksSession.usedUdpPorts.has(port)) {
                SocksSession.usedUdpPorts.add(port);
                return port;
            }
        }
        throw new Error('No available UDP ports');
    }

    private sessionCleanup() {
        SocksSession.usedUdpPorts.delete(this.udpPort);

        // Other cleanup code
        if (this.clientSocket && !this.clientSocket.destroyed) {
            this.clientSocket.end();
        }
        this.logger.info(`Cleaned up session`);
    }
}