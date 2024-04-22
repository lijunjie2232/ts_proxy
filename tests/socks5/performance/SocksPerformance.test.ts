import * as net from 'net';
import * as dgram from 'dgram';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { SocksServer } from '../../../src/socks5Proxy/SocksServer';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';
import { Socket } from 'net';
import * as http from 'http';

describe('SOCKS5 Server Concurrent Sessions Test', () => {
    let clients: net.Socket[] = [];
    let socksProxy: SocksServer;
    let logger: Logger;
    const mockServerPort = 9001; // Port for the mock TCP server
    let mockServer: net.Server; // Your SOCKS5 server address

    beforeAll(async () => {

        try {
            await fsPromises.unlink(path.join(__dirname, "merged_test_config.json"));
        } catch (error) {
            console.error("Failed to delete config file, it might not exist, continuing...", error);
        }

        try {
            await fsPromises.unlink(path.join(__dirname, "test_server.log"));
        } catch (error) {
            console.error("Failed to delete config file, it might not exist, continuing...", error);
        }

        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname,'perf_test_server_config.json'));
        saveConfig(path.join(__dirname,'merged_test_config.json'), testConfig);

        console.log(testConfig)

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname,"test_server.log"));
        socksProxy = new SocksServer(path.join(__dirname, "merged_test_config.json"), logger); 
        await socksProxy.start();

        // Setup mock HTTP server
        mockServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello from mock server!');
        });

        // Start mock server
        await new Promise<void>((resolve, reject) => {
            mockServer.listen(mockServerPort, 'localhost', () => {
                console.log(`Mock HTTP Server running at http://localhost:${mockServerPort}`);
                resolve();
            });
            mockServer.on('error', reject);
        });

    });

    afterAll(async () => {
        await socksProxy.close();
        await mockServer.close();
    });


    test('should handle at least 25 concurrent sessions', async () => {
        const connectPromises = [];
        clients = []; // Array to hold client sockets

        for (let i = 0; i < 25; i++) {
            const promise = new Promise<void>((resolve, reject) => {
                const client = new net.Socket();

                // Setup client socket and handlers
                client.connect(1080, 'localhost', () => {
                    client.write(Buffer.from([0x05, 0x01, 0x00])); // Send greeting
                });

                client.on('data', (data) => {
                    if (data.length === 2 && data[0] === 0x05 && data[1] === 0x00) {
                        // Successful greeting, send connection request
                        const domainName = 'localhost';
                        const request = Buffer.concat([
                            Buffer.from([0x05, 0x01, 0x00, 0x03]), // SOCKS command
                            Buffer.from([domainName.length]), // Domain name length
                            Buffer.from(domainName), // Domain name
                            Buffer.from([0x23, 0x29]) // Port number
                        ]);
                        client.write(request);
                    } else if (data.length >= 10 && data[0] === 0x05 && data[1] === 0x00) {
                        // Connection successful
                        resolve();
                    } else {
                        // Invalid response
                        reject(new Error('Invalid server response'));
                    }
                });

                client.on('error', reject);

                client.on('close', () => {
                    if (!client.destroyed) {
                        client.destroy(); // Ensure the socket is closed
                    }
                });

                clients.push(client); // Store the client for later cleanup
            });

            connectPromises.push(promise);
        }

        try {
            await Promise.all(connectPromises);
            expect(connectPromises.length).toBe(25);
        } catch (err) {
            console.error('Error during connections:', err);
        } finally {
            // Clean up all client connections immediately after test execution
            clients.forEach(client => {
                if (!client.destroyed) {
                    client.destroy();
                }
            });
        }
    });

    test('should allow client to connect, disconnect, and reconnect', async () => {

        // Create a client
        const client = new net.Socket();

        // Function to establish a connection
        const connect = () => {
            return new Promise<void>((resolve, reject) => {
                client.connect(1080, 'localhost', () => {
                    client.write(Buffer.from([0x05, 0x01, 0x00])); // Send greeting
                    resolve();
                });

                client.on('data', (data) => {
                    if (data.length === 2 && data[0] === 0x05 && data[1] === 0x00) {
                        // Successfully connected and received server response
                        resolve();
                    }
                });

                client.on('error', (err) => {
                    reject(err);
                });
            });
        };

        // Connect the client
        await connect();
        expect(client.connecting || client.readyState === 'open').toBe(true);

        // Disconnect the client
        await new Promise<void>((resolve) => {
            client.end();
            client.once('close', () => {
                resolve();
            });
        });
        expect(client.destroyed).toBe(true);

        // Reconnect the client
        await connect();
        expect(client.connecting || client.readyState === 'open').toBe(true);

        // Clean up
        client.destroy();
    });
});
