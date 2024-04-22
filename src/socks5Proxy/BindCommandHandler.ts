import * as net from 'net';
import { CommandHandler } from './CommandHandler';
import { UserPassAuth } from '../Auth';
import { sendReply } from '../utils';
import { ConfigManager } from '../ConfigManager';
import { Logger } from '../Logger'

export class BindCommandHandler extends CommandHandler {
    private listeningSocket: net.Server | null = null;
    private remoteSocket: net.Socket | null = null;
    private isClosed: boolean = false;

    constructor(clientSocket: net.Socket, data: Buffer, configManager: ConfigManager, logger: Logger) {
        super(clientSocket, data, configManager, logger);
        this.processCommand();
    }

    protected processCommand() {
        this.listeningSocket = new net.Server();

        this.listeningSocket.on('error', (err) => {
            this.logger.error('BIND listening socket error:', err);
            sendReply(this.clientSocket, 0x01); // General SOCKS server failure
            this.cleanup();
        });

        this.listeningSocket.listen(0, this.configManager.config.server.socks5.serverIP, () => {
            const address = this.listeningSocket?.address() as net.AddressInfo;
            //this.logger.info(`BIND listening socket at ${this.listeningSocket?.address().address}:${this.listeningSocket?.address().port}`);
            sendReply(this.clientSocket, 0x00, this.configManager.config.server.socks5.serverIP, address.port);
            this.listeningSocket?.once('connection', this.handleConnection);
        });
    }

    private handleConnection = (socket: net.Socket) => {
        this.remoteSocket = socket;
        if (!socket.remoteAddress || !socket.remotePort) {
            this.logger.error('BIND command: No remote address or port');
            sendReply(this.clientSocket, 0x01);
            this.cleanup();
            return;
        }

        const remoteAddress = socket.remoteAddress;
        const remotePort = socket.remotePort;
        sendReply(this.clientSocket, 0x00, remoteAddress, remotePort);

        this.setupDataRelay(socket);
    };

    private setupDataRelay(socket: net.Socket) {
        socket.on('data', (data) => {
            this.logger.debug('Relaying data back to client...');
            this.clientSocket.write(data);
        });

        this.clientSocket.on('data', (data) => {
            this.logger.debug('Relaying data to remote server...');
            socket.write(data);
        });

        socket.on('close', () => {
            this.logger.info('BIND remote socket closed');
            this.cleanup();
        });

        socket.on('error', (err) => {
            this.logger.error('BIND remote socket error:', err);
            this.cleanup();
        });
    }

    public relayData(data: Buffer): void {
        if (this.remoteSocket && !this.remoteSocket.destroyed) {
            this.remoteSocket.write(data);
        }
    }

    protected cleanup() {
        if (this.isClosed) return; 
        this.isClosed = true;

        if (this.remoteSocket && !this.remoteSocket.destroyed) {
            this.remoteSocket.destroy();
            this.remoteSocket = null;
        }

        if (this.listeningSocket) {
            this.listeningSocket.close(() => {
                this.logger.info('BIND listening socket closed.');
            });
            this.listeningSocket = null;
        }

        super.cleanup();
    }
}