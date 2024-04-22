import * as net from 'net';
import * as dgram from 'dgram';
import { ConfigManager } from '../ConfigManager';
import { Logger } from '../Logger'

export abstract class CommandHandler {
    protected clientSocket: net.Socket;
    protected configManager: ConfigManager;
    protected data: Buffer;
    protected logger: Logger;

    constructor(clientSocket: net.Socket, data: Buffer, configManager: ConfigManager, logger: Logger) {
        this.clientSocket = clientSocket;
        this.data = data;
        this.configManager = configManager;
        this.logger = logger;
    }

    // Abstract method to process specific commands in derived classes
    protected abstract processCommand(): void;

    //abstract relayData(data: Buffer, rinfo?: dgram.RemoteInfo): void;

    // Common cleanup method for all handlers
    protected cleanup() {
        // Close the client socket if it's still open
        if (this.clientSocket && !this.clientSocket.destroyed) {
            this.clientSocket.end();
        }
    }
}
