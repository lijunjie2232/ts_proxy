import * as net from 'net';
import * as dgram from 'dgram';
import { CommandHandler } from './CommandHandler';
import { ConfigManager } from '../ConfigManager';
import { parseDestination, determinePayloadStartIndex } from '../utils';
import { Logger } from '../Logger'

interface ClientSession {
    clientAddress: string;
    clientPort: number;
    destinationAddress?: string;
    destinationPort?: number;
};

export class UdpAssociateHandler extends CommandHandler {
    private udpSocket: dgram.Socket;
    private clientSessions: Map<string, ClientSession>;
    private udpPort: number;
    private isSocketClosed: boolean = false;

    constructor(clientSocket: net.Socket, data: Buffer, configManager: ConfigManager, udpPort: number, logger: Logger) {
        super(clientSocket, data, configManager, logger);
        this.udpPort = udpPort;
        this.udpSocket = dgram.createSocket('udp4');
        this.clientSessions = new Map();
        this.listenForUdpDatagrams();
        this.processCommand();
        this.clientSocket.on('close', () => {
            this.cleanup();
        });
    }

    protected async processCommand() {
        try {
            await this.sendUdpAssociateResponse(this.udpPort);
        } catch (error) {
            this.logger.error('Error processing UDP associate command:', error);
        }
    }

    private async sendUdpAssociateResponse(port: number): Promise<void> {
        const response = this.createUdpAssociateResponse(port);
        this.clientSocket.write(response, (err) => {
            if (err) {
                this.logger.error('Error sending UDP associate response:', err);
            }
        });
    }

    private createUdpAssociateResponse(port: number): Buffer {
        const serverIp = this.configManager.config.server.socks5.serverIP;
        const ipBuffer = Buffer.from(serverIp.split('.').map(Number));
        const response = Buffer.alloc(10);
        response[0] = 0x05; // SOCKS version
        response[1] = 0x00; // Success
        response[2] = 0x00; // Reserved
        response[3] = 0x01; // Address type (IPv4)
        ipBuffer.copy(response, 4); // Server IP
        response.writeUInt16BE(port, 8); // Server Port

        return response;
    }

    private listenForUdpDatagrams(): void {
        this.udpSocket.bind({ port: this.udpPort,  address: this.configManager.config.server.socks5.serverIP }, () => {
            this.logger.info(`UDP socket bound to ${this.configManager.config.server.socks5.serverIP} and listening on port ${this.udpPort}`);
        });
        this.udpSocket.on('message', (msg, rinfo) => {
            this.logger.debug(`Received UDP message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
            this.handleUdpDatagram(msg, rinfo);
        });
        this.udpSocket.on('error', (err) => {
            this.logger.error('UDP socket error:', err);
            this.cleanup();
        });
        this.udpSocket.on('close', () => {
            this.logger.info('UDP socket closed');
            this.cleanup();
        });
    }

    private handleUdpDatagram(msg: Buffer, rinfo?: dgram.RemoteInfo): void {
        if (rinfo) {
            try {
                this.logger.debug("Msg :", msg);
                this.logger.debug("Rinfo :", rinfo);

                const clientKey = `${rinfo.address}:${rinfo.port}`;
                let session = this.clientSessions.get(clientKey);

                this.logger.debug("Sessions:", this.clientSessions)
                this.logger.debug("clientKey:", clientKey)
                this.logger.debug("session:", session)

                if (!session && this.isSocks5Message(msg)) {
                    // It's a new session from the client
                    const { host, port } = parseDestination(msg);
                    session = { clientAddress: rinfo.address, clientPort: rinfo.port, destinationAddress: host, destinationPort: port };
                    this.clientSessions.set(clientKey, session);
                } else {
                    session = this.findSessionByDestination(rinfo.address, rinfo.port);
                }

                if (session) {

                    this.logger.debug("rinfo address:", rinfo.address);
                    this.logger.debug("rinfo port:", rinfo.port);

                    this.logger.debug("session.clientAddress:", session.clientAddress);
                    this.logger.debug("session.clientPort:", session.clientPort);

                    this.logger.debug("session.destinationAddress:", session.destinationAddress);
                    this.logger.debug("session.destinationPort:", session.destinationPort);

                    if (rinfo.address === session.clientAddress && rinfo.port === session.clientPort) {
                        this.logger.debug('Message above is from client')
                        // Message is from the client
                        if (this.isSocks5Message(msg)) {
                            // If it's a SOCKS5 message, forward it to the remote server
                            this.sendToRemoteServer(msg, session);
                            this.logger.debug('Message above forwarded to remote server')
                        }
                    } else if (session.destinationAddress === rinfo.address && session.destinationPort === rinfo.port) {
                        this.logger.debug('Message above is from remote server')
                        // Message is from the remote server, forward it to the client
                        this.sendToClient(msg, session);
                        this.logger.debug('Message above forwarded to client')
                    }
                }

            } catch (error) {
                this.logger.error('Error processing UDP associate command:', error);
            }           
        } else {
            this.logger.error('Error processing UDP associate command: rinfo not provided');
        }
    }

    private isSocks5Message(msg: Buffer): boolean {
        // Check if the message has a minimum length and a valid SOCKS5 header
        return msg.length > 10 && (msg[3] === 0x01 || msg[3] === 0x03 || msg[3] === 0x04); // Checks for IPv4, Domain, and IPv6
    }


    private findSessionByDestination(address: string, port: number): ClientSession | undefined {
        for (let [key, session] of this.clientSessions.entries()) {
            if (session.destinationAddress === address && session.destinationPort === port) {
                return session;
            }
        }
        return undefined;
    }

    private sendToRemoteServer(msg: Buffer, session: ClientSession) {
        const payloadStartIndex = determinePayloadStartIndex(msg);
        const payload = msg.slice(payloadStartIndex);
        if (session.destinationAddress && session.destinationPort) {
            this.udpSocket.send(payload, session.destinationPort, session.destinationAddress, (err) => {
                if (err) {
                    this.logger.error('Error sending to remote server:', err);
                }
            this.logger.info(`Send to remote server at ${ session.destinationAddress }:${ session.destinationPort }`)
            });
        }
    }

    private sendToClient(msg: Buffer, session: ClientSession): void {
        if (session && session.clientAddress && session.clientPort) {
            const response = this.constructSocks5Response(msg, session.clientAddress, session.clientPort);
            this.udpSocket.send(response, session.clientPort, session.clientAddress, (err) => {
                if (err) {
                    this.logger.error('Error sending to client:', err);
                }
            this.logger.info(`Send to client at ${ session.clientAddress }:${ session.clientPort }`)
            });
        }
    }

    private constructSocks5Response(msg: Buffer, clientAddress: string, clientPort: number): Buffer {
        const reserved = Buffer.alloc(2); // Reserved bytes set to zero
        const fragmentNumber = Buffer.from([0x00]); // Fragment number
        const addressType = net.isIPv6(clientAddress) ? 0x04 : 0x01; // Address type (IPv4 or IPv6)
        const addressBuffer = net.isIPv6(clientAddress) ? this.convertIPv6Address(clientAddress) : Buffer.from(clientAddress.split('.').map(Number));
        const portBuffer = Buffer.alloc(2);
        portBuffer.writeUInt16BE(clientPort, 0);

        return Buffer.concat([
            reserved, 
            fragmentNumber, 
            Buffer.from([addressType]), 
            addressBuffer, 
            portBuffer, 
            msg
        ]);
    }

    private convertIPv6Address(address: string): Buffer {
        return Buffer.from(address.split(':').flatMap(part => {
            if (part.length === 0) {
                return Array(4).fill(0);
            } else {
                const matches = part.match(/.{1,2}/g) || []; // Fallback to empty array if null
                return matches.map(byte => parseInt(byte, 16));
            }
        }));
    }

    protected cleanup() {
        this.logger.info('Cleaning UDP command handler')
        if (this.isSocketClosed) return;
        this.isSocketClosed = true;

        this.udpSocket.removeAllListeners();
        this.udpSocket.close(() => {
            this.logger.info('UDP socket closed.');
        });

        super.cleanup(); // Clean up any resources allocated by the parent class
    }
}
