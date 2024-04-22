import * as net from 'net';
import { parseDestination, sendReply } from '../utils';
import { CommandHandler } from './CommandHandler';
import { ConfigManager } from '../ConfigManager';
import { Logger } from '../Logger';

export class ConnectCommandHandler extends CommandHandler {
    private destinationSocket: net.Socket | null = null;

    constructor(clientSocket: net.Socket, data: Buffer, configManager: ConfigManager, logger: Logger) {
        super(clientSocket, data, configManager, logger);
        this.processCommand();
    }

    protected async processCommand() {
        this.logger.debug("Processing CONNECT command");

        const version = this.data[0];
        const command = this.data[1];
        const reserved = this.data[2];

        if (version !== 0x05 || command !== 0x01 || reserved !== 0x00) {
            this.logger.error("Invalid CONNECT command or version");
            sendReply(this.clientSocket, 0x01); // General SOCKS server failure
            this.cleanup();
            return;
        }

        try {
            const destination = parseDestination(this.data);
            this.logger.info(`Attempting to connect to ${destination.host}:${destination.port}`);

            this.destinationSocket = net.createConnection({ 
                host: destination.host, 
                port: destination.port
            }, () => {
                this.logger.info("Connection to remote server established");
                sendReply(this.clientSocket, 0x00); // Success
                this.setupDataRelay();
            });

            this.destinationSocket.on('error', (err) => {
                this.logger.error("Remote connection error: ", err);
                sendReply(this.clientSocket, 0x01); // General SOCKS server failure
                this.cleanup();
            });

        } catch (error) {
            this.logger.error("Error processing CONNECT command: ", error);
            sendReply(this.clientSocket, 0x01); // General SOCKS server failure
            this.cleanup();
        }
    }

    private setupDataRelay() {
        if (!this.destinationSocket) return;

        // Relay from client to destination
        this.clientSocket.on('data', (data) => {
            this.logger.debug("Relaying data to remote server...", data);
            this.destinationSocket?.write(data);
        });

        // Relay from destination back to client
        this.destinationSocket.on('data', (data) => {
            this.logger.debug("Relaying data back to client...", data);
            this.clientSocket.write(data);
        });

        // Cleanup on client socket end
        this.clientSocket.on('end', () => this.cleanup());
        this.clientSocket.on('error', (err) => {
            this.logger.debug('Error from client socket:', err)
            this.cleanup()
        });
    }

    public relayData(data: Buffer): void {
        // This method might not be necessary if all data relay is handled within processCommand
    }

    protected cleanup() {
        this.logger.info("Cleaning up CONNECT command handler");
        if (this.destinationSocket && !this.destinationSocket.destroyed) {
            this.destinationSocket.destroy();
            this.destinationSocket = null;
        }
        if (!this.clientSocket.destroyed) {
            this.clientSocket.destroy();
        }
        super.cleanup();
    }
}