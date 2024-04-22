import * as net from 'net';
import * as dgram from 'dgram';
import * as tls from 'tls';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { SocksServer } from '../../../src/socks5Proxy/SocksServer';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';
import * as fs from 'fs';


describe('SOCKS5 Server - CONNECT Command', () => {
    let udpMockServer: dgram.Socket;
    let mockServer: net.Server;
    const mockServerPort = 9001; // Port for the mock TCP server
    const socksServerAddress = 'localhost'; // Your SOCKS5 server address
    const socksServerPort = 1080; // Your SOCKS5 server port
    let client: net.Socket;
    let udpServerIsOpen = false;

    let socksProxy: SocksServer;
    let logger: Logger;


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

        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname,'functional_test_server_config.json'));
        saveConfig(path.join(__dirname,'merged_test_config.json'), testConfig);

        console.log(testConfig)

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname,"test_server.log"));
        socksProxy = new SocksServer(path.join(__dirname, "merged_test_config.json"), logger); 
        await socksProxy.start();
    });

    afterAll(async () => {
        await socksProxy.close();
    });


    beforeEach(done => {
        client = new net.Socket();

        mockServer = net.createServer(socket => {
            socket.on('data', data => {
                console.log('Mock server received data:', data.toString());
                socket.write(data); // Echo the data back to the client
            });
        });

        mockServer.listen(mockServerPort, '127.0.0.1', () => {
            udpMockServer = dgram.createSocket('udp4');
            udpMockServer.on('message', (msg, rinfo) => {
                console.log(`Mock UDP Server received: ${msg} from ${rinfo.address}:${rinfo.port}`);
                udpMockServer.send(msg, rinfo.port, rinfo.address); // Echo back the message
            });

            udpMockServer.bind(0, "127.0.0.1", () => {
                udpServerIsOpen = true;
                done(); // Indicate completion of setup
            });
        });
    });

    afterEach(done => {
        // Close the client socket
        if (client) {
            client.end();
            client.destroy(); // Ensure the client socket is fully closed
            //client = null;
        }

        const closeMockServer = (callback: () => void) => {
            if (mockServer && mockServer.listening) {
                mockServer.close(() => {
                    //mockServer = null; // Dereference for garbage collection
                    callback();
                });
            } else {
                callback();
            }
        };

        const closeUdpMockServer = (callback: () => void) => {
            if (udpMockServer && udpServerIsOpen) {
                udpMockServer.close(() => {
                    udpServerIsOpen = false; // Reset the flag when the UDP server is closed
                    //udpMockServer = null; // Dereference for garbage collection
                    callback();
                });
            } else {
                callback();
            }
        };

        closeMockServer(() => closeUdpMockServer(done));
    });

    test('TCP client should connect through SOCKS5 server and exchange data', async () => {
        await new Promise<void>((resolve, reject) => {
            client.connect(socksServerPort, socksServerAddress, resolve);
            client.on('error', reject);
        });

        // Step 1: Send Greeting
        const greeting = Buffer.from([0x05, 0x01, 0x00]); // SOCKS5, 1 auth method, 0x00 - no authentication
        client.write(greeting);

        // Step 2: Receive Server's Response to Greeting
        const greetingResponse = await new Promise<Buffer>((resolve) => {
            client.once('data', resolve);
        });
        console.log('Greeting response:', greetingResponse);

        // Validate the greeting response
        if (greetingResponse.length !== 2 || greetingResponse[0] !== 0x05) {
            throw new Error('Invalid greeting response from SOCKS5 server');
        }

        // Step 3: Send CONNECT command
        const connectCommand = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x01]), // SOCKS version, CONNECT command, reserved, IPv4 address type
            ...parseIPv4Address('127.0.0.1'),    // Target address (mock server)
            Buffer.from([mockServerPort >> 8, mockServerPort & 0xFF]) // Target port
        ]);
        console.log('Connect command', connectCommand);
        client.write(connectCommand);

        // Step 4: Receive Server's Response to CONNECT
        const connectResponse = await new Promise<Buffer>((resolve) => {
            client.once('data', resolve);
        });
        console.log('Connect response:', connectResponse);

        // Validate the CONNECT response
        if (connectResponse.length < 10 || connectResponse[0] !== 0x05 || connectResponse[1] !== 0x00) {
            throw new Error('Invalid CONNECT response from SOCKS5 server');
        }

        // Step 5: Exchange Data (Test Echo)
        const testData = 'Hello, SOCKS5!';
        client.write(testData);

        const echoData = await new Promise<Buffer>((resolve) => {
            client.once('data', resolve);
        });

        expect(echoData.toString()).toBe(testData);
        //client.end();
    });

    test('Client should use BIND command to receive incoming connections', async () => {

        const externalClient = new net.Socket();
        // Connect to the SOCKS5 server
        await new Promise<void>((resolve, reject) => {
            client.connect(socksServerPort, socksServerAddress, resolve);
            client.on('error', reject);
        });

        // Step 1: Send Greeting
        client.write(Buffer.from([0x05, 0x01, 0x00])); // SOCKS5, 1 auth method, 0x00 - no authentication

        // Step 2: Receive Server's Response to Greeting
        const greetingResponse = await new Promise<Buffer>(resolve => client.once('data', resolve));
        expect(greetingResponse).toEqual(Buffer.from([0x05, 0x00])); // Expect success response

        // Step 3: Send BIND command
        client.write(Buffer.concat([
            Buffer.from([0x05, 0x02, 0x00, 0x01]), // SOCKS version, BIND command, reserved, IPv4 address type
            Buffer.from([0x00, 0x00, 0x00, 0x00]), // All zeros for IP
            Buffer.from([0x00, 0x00])             // Zero port
        ]));

        // Step 4: Receive Server's Response to BIND
        const bindResponse = await new Promise<Buffer>(resolve => client.once('data', resolve));
        expect(bindResponse.length).toBeGreaterThanOrEqual(10);
        expect(bindResponse[0]).toBe(0x05); // SOCKS version
        expect(bindResponse[1]).toBe(0x00); // Success response

        const bindAddress = bindResponse.slice(4, 8).join('.');
        const bindPort = bindResponse.readUInt16BE(8);

        // Step 5: External Client Connects to the BIND Address
        await new Promise<void>((resolve, reject) => {
            externalClient.connect(bindPort, bindAddress, resolve);
            externalClient.on('error', reject);
        });

        // Step 6: Send and Receive Data
        const testData = 'Hello through BIND!';
        externalClient.write(testData);

        const receivedDataWithHeader = await new Promise<Buffer>(resolve => client.once('data', resolve));

        // Assuming the SOCKS5 header is a fixed length (e.g., 10 bytes for IPv4)
        const socksHeaderLength = 10;
        const actualReceivedData = receivedDataWithHeader.slice(socksHeaderLength);

        // Validate the actual data payload
        expect(actualReceivedData.toString()).toBe(testData);

        externalClient.end();
        externalClient.destroy();
        externalClient.removeAllListeners();
    });

    test('Client should use UDP ASSOCIATE command for UDP packet exchange', async () => {

        const mockServerAddress = udpMockServer.address();
        const mockServerPort = mockServerAddress.port;
        console.log("Mock server listening on:", mockServerAddress);

        // Connect the client to the SOCKS5 server
        await new Promise<void>((resolve, reject) => {
            client.connect(socksServerPort, socksServerAddress, resolve);
            client.on('error', reject);
        });

        // Step 1: Send Greeting
        client.write(Buffer.from([0x05, 0x01, 0x00])); // SOCKS5, 1 method, no authentication

        // Step 2: Receive Server's Response to Greeting
        const greetingResponse = await new Promise<Buffer>((resolve) => client.once('data', resolve));
        expect(greetingResponse).toEqual(Buffer.from([0x05, 0x00])); // Check for success

        // Step 3: Send UDP ASSOCIATE command
        client.write(Buffer.concat([
            Buffer.from([0x05, 0x03, 0x00, 0x01]), // SOCKS version, UDP ASSOCIATE, reserved, IPv4
            Buffer.from([127, 0, 0, 1]), // Any IP for UDP ASSOCIATE
            Buffer.from([0x00, 0x00])             // Any port for UDP ASSOCIATE
        ]));

        // Step 4: Receive UDP ASSOCIATE response
        const udpAssociateResponse = await new Promise<Buffer>((resolve) => client.once('data', resolve));

        console.log("udpAssociateResponse:", udpAssociateResponse);

        expect(udpAssociateResponse.length).toBeGreaterThanOrEqual(10);
        expect(udpAssociateResponse[0]).toBe(0x05); // SOCKS version
        expect(udpAssociateResponse[1]).toBe(0x00); // Success response

        const udpAssociateAddress = udpAssociateResponse.slice(4, 8).join('.');
        const udpAssociatePort = udpAssociateResponse.readUInt16BE(8);

        console.log("udpAssociateAddress:", udpAssociateAddress);
        console.log("udpAssociatePort:", udpAssociatePort);

        console.log("socksServerAddress:", socksServerAddress);
        console.log("socksServerPort:", socksServerPort);

        // Step 5: Create UDP client for data exchange
        const udpClient = dgram.createSocket('udp4');
        const testData = 'Hello through UDP ASSOCIATE!';

        const socks5Header = Buffer.alloc(10); // 10 bytes for the SOCKS5 header
        socks5Header[0] = 0x00; // Reserved
        socks5Header[1] = 0x00; // Reserved
        socks5Header[2] = 0x00; // Fragment number
        socks5Header[3] = 0x01; // Address type (IPv4)

        const mockServerIpBuffer = Buffer.from(mockServerAddress.address.split('.').map(Number));
        mockServerIpBuffer.copy(socks5Header, 4); // Mock server IP
        socks5Header.writeUInt16BE(mockServerPort, 8); // Mock server port

        const packet = Buffer.concat([socks5Header, Buffer.from(testData)]);

        console.log("packet:", packet);

        udpClient.send(packet, udpAssociatePort, udpAssociateAddress);

        // Step 6: Wait for response from mock UDP server
        const receivedData = await new Promise<Buffer>((resolve) => {
            udpMockServer.once('message', (msg) => resolve(msg));
        });

        console.log("receivedData:", receivedData);

        expect(receivedData.toString()).toBe(testData);
        udpClient.close()
    });
});


function parseIPv4Address(address: string): Buffer[] {
    return [Buffer.from(address.split('.').map(num => parseInt(num, 10)))];
}



