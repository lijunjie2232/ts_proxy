import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { HttpProxy } from '../../../src/httpProxy/HttpProxy';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';
import * as fs from 'fs';
import { Socket } from 'net';


describe('HTTP Proxy Server Tests', () => {
    let httpProxy: HttpProxy;
    let logger: Logger;
    let mockServer: http.Server;
    let mockServerPort: number = 3000; // Assign a free port for the mock server
    let mockHttpsServer: https.Server;
    const mockHttpsServerPort = 3443;

    beforeAll(async () => {
        // Cleanup
        try {
            await fsPromises.unlink(path.join(__dirname,"merged_test_config.json"));
            await fsPromises.unlink(path.join(__dirname,"test_server.log"));
        } catch (error) {
            console.error("Cleanup failed, continuing...", error);
        }

        // Load and save configuration
        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname, 'functional_test_server_config.json'));
        await saveConfig(path.join(__dirname, 'merged_test_config.json'), testConfig);

        logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname, "test_server.log"));
        httpProxy = new HttpProxy(path.join(__dirname, "merged_test_config.json"), logger); 
        await httpProxy.start();

        // Setup mock HTTP server
        mockServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello from mock server!');
        });

        mockServer.on('upgrade', (req, socket: Socket, head) => handleWebSocket(req, socket as Socket, head));

        // Start mock server
        await new Promise<void>((resolve, reject) => {
            mockServer.listen(mockServerPort, 'localhost', () => {
                console.log(`Mock HTTP Server running at http://localhost:${mockServerPort}`);
                resolve();
            });
            mockServer.on('error', reject);
        });

        // Setup mock HTTPS server
        const options = {
            key: fs.readFileSync(path.join(__dirname, '../../private.key')),
            cert: fs.readFileSync(path.join(__dirname, '../../certificate.crt'))
        };

        mockHttpsServer = https.createServer(options, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello from mock HTTPS server!');
        });
        mockHttpsServer.on('upgrade', (req, socket: Socket, head) => handleWebSocket(req, socket as Socket, head));

        // Start mock HTTPS server
        await new Promise<void>((resolve, reject) => {
            mockHttpsServer.listen(mockHttpsServerPort, 'localhost', () => {
                console.log(`Mock HTTPS Server running at https://localhost:${mockHttpsServerPort}`);
                resolve();
            });
            mockHttpsServer.on('error', reject);
        });
    });

    afterAll(async () => {
        await httpProxy.close();
        await mockServer.close();
        await mockHttpsServer.close();
    });

    function handleWebSocket(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Accept: ' + 
            crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + 
            '\r\n\r\n'
        );

        socket.on('data', (data) => {
            // Here you would need to handle WebSocket frames
            console.log('WebSocket frame received: ', data.toString());
        });

        socket.on('end', () => {
            console.log('Socket ended');
        });
    }

    test('Can handle HTTP requests to URL', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}/`; // Directly use the mock server

        // Set up the request options for the proxy
        const requestOptions: http.RequestOptions = {
            host: proxyHost,
            port: proxyPort,
            path: targetUrl,
            method: 'GET',
            headers: {
                'Host': new URL(targetUrl).hostname
            }
        };

        // Create an HTTP request through the proxy
        const req = http.request(requestOptions, (res) => {
            let data = '';

            // Listen for data chunks
            res.on('data', (chunk) => {
                data += chunk;
            });

            // The request is complete
            res.on('end', () => {
                try {
                    expect(res.statusCode).toBe(200);
                    expect(data).toContain('Hello from mock server!');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        // Handle request error
        req.on('error', (err) => {
            done(err);
        });

        // End the request
        req.end();
    });

    test('Can handle HTTP requests to IPv4 address', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081;
        const targetUrl = 'http://127.0.0.1:3000'; // Local mock server's IPv4 address and port

        const requestOptions = {
            host: proxyHost,
            port: proxyPort,
            path: targetUrl,
            method: 'GET',
            headers: {
                'Host': 'localhost' // Using localhost since we are pointing to the mock server
            }
        };

        // Create an HTTP request through the proxy
        const req = http.request(requestOptions, (res) => {
            let data = '';

            // Listen for data chunks
            res.on('data', (chunk) => {
                data += chunk;
            });

            // The request is complete
            res.on('end', () => {
                try {
                    expect(res.statusCode).toBe(200);
                    expect(data).toContain('Hello from mock server!');
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        // Handle request error
        req.on('error', (err) => {
            done(err);
        });

        // End the request
        req.end();
    });

    test('Can handle HTTPS requests to URL', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Proxy server port
        const targetHost = 'localhost';
        const targetPort = 3443; // Local mock HTTPS server port

        // Connect to the proxy server
        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request to the proxy server
            proxySocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n`);
        });

        let tlsSocket: tls.TLSSocket | null = null;

        proxySocket.on('data', (chunk) => {
            // Look for the end of the HTTP header (empty line)
            if (chunk.toString().indexOf('\r\n\r\n') !== -1 && !tlsSocket) {
                // Upgrade the connection to TLS
                tlsSocket = tls.connect({
                    socket: proxySocket,
                    servername: targetHost, // SNI, important for TLS connection
                    rejectUnauthorized: false // Necessary for self-signed certificates
                }, () => {
                    // TLS handshake complete, send HTTP request
                    tlsSocket!.write('GET / HTTP/1.1\r\n');
                    tlsSocket!.write(`Host: ${targetHost}\r\n`);
                    tlsSocket!.write('\r\n');
                });

                tlsSocket.on('data', (chunk) => {
                    if (chunk.toString().indexOf('HTTP/1.1 200 OK') !== -1) {
                        cleanupSockets();
                        done();
                    }
                });

                tlsSocket.on('error', (err) => {
                    cleanupSockets();
                    done(err);
                });
            }
        });

        proxySocket.on('error', (err) => {
            cleanupSockets();
            done(err);
        });

        const cleanupSockets = () => {
            tlsSocket?.removeAllListeners();
            tlsSocket?.destroy();
            proxySocket.removeAllListeners();
            proxySocket.destroy();
        };
    });

    test('Can handle HTTPS requests to IPV4', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081;
        const targetHost = '127.0.0.1';  // Local IPv4 address of mock HTTPS server
        const targetPort = 3443;  // Port of the mock HTTPS server

        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            proxySocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n`);
        });

        let tlsSocket: tls.TLSSocket | null = null;

        proxySocket.on('data', (chunk) => {
            if (chunk.toString().includes('HTTP/1.1 200 Connection Established')) {
                tlsSocket = tls.connect({
                    socket: proxySocket,
                    rejectUnauthorized: false,
                    servername: targetHost
                });

                tlsSocket.on('secureConnect', () => {
                    tlsSocket!.write('GET / HTTP/1.1\r\n');
                    tlsSocket!.write(`Host: ${targetHost}\r\n`);
                    tlsSocket!.write('\r\n');
                });

                tlsSocket.on('data', (chunk) => {
                    if (chunk.toString().includes('HTTP/1.1 200 OK')) {
                        cleanupSockets();
                        done();
                    }
                });

                tlsSocket.on('error', (err) => {
                    cleanupSockets();
                    done(err);
                });
            }
        });

        proxySocket.on('error', (err) => {
            cleanupSockets();
            done(err);
        });

        const cleanupSockets = () => {
            tlsSocket?.removeAllListeners();
            tlsSocket?.destroy();
            proxySocket.removeAllListeners();
            proxySocket.destroy();
        };
    }, 10000); // Extended timeout to allow for connection setup


    test('Can handle WebSocket over HTTP', async () => {
        const proxyHost = 'localhost';
        const proxyPort = 1081;
        const targetHost = 'localhost';
        let key: string;
        let expectedAccept: string;
        const proxySocket = net.connect({ port: proxyPort, host: proxyHost });
        await new Promise<void>((resolve, reject) => {
            proxySocket.on('connect', () => {
                proxySocket.write(`CONNECT ${targetHost}:3000 HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n`);
            });

            proxySocket.on('data', (chunk) => {
                const response = chunk.toString();
                if (response.includes('HTTP/1.1 200 Connection Established')) {
                    key = crypto.randomBytes(16).toString('base64');
                    expectedAccept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
                    
                    const handshakeRequest = [
                        'GET / HTTP/1.1',
                        `Host: ${targetHost}`,
                        'Upgrade: websocket',
                        'Connection: Upgrade',
                        `Sec-WebSocket-Key: ${key}`,
                        'Sec-WebSocket-Version: 13',
                        '\r\n'
                    ].join('\r\n');

                    proxySocket.write(handshakeRequest);
                } else if (response.includes('Sec-WebSocket-Accept')) {
                    expect(response.includes(expectedAccept)).toBeTruthy();
                    resolve();
                }
            });

            proxySocket.on('error', (err) => {
                reject(err);
            });

            proxySocket.on('end', resolve);
        });

        // Cleanup after the promise resolves or rejects
        await proxySocket.end();
        await proxySocket.destroy();
    });

    test('Can handle WebSocket over HTTPS', async () => {
        const proxyHost = 'localhost';
        const proxyPort = 1081;
        const targetHost = 'localhost';
        const targetPort = 3443;

        const proxySocket = net.connect(proxyPort, proxyHost);

        // Await the initial connection and the CONNECT request to the HTTPS server
        await new Promise<void>((resolve, reject) => {
            proxySocket.on('connect', () => {
                proxySocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n`);
                resolve();
            });

            proxySocket.on('error', reject);
        });

        let tlsSocket: tls.TLSSocket | undefined;
        const response = await new Promise<string>((resolve, reject) => {
            proxySocket.on('data', (chunk) => {
                if (chunk.toString().includes('HTTP/1.1 200 Connection Established')) {
                    // Securely connect to the target over the established tunnel
                    tlsSocket = tls.connect({ socket: proxySocket, servername: targetHost, rejectUnauthorized: false }, () => {
                        const key = crypto.randomBytes(16).toString('base64');
                        const expectedAccept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');

                        const handshakeRequest = [
                            'GET / HTTP/1.1',
                            `Host: ${targetHost}`,
                            'Upgrade: websocket',
                            'Connection: Upgrade',
                            `Sec-WebSocket-Key: ${key}`,
                            'Sec-WebSocket-Version: 13',
                            '\r\n'
                        ].join('\r\n');

                        tlsSocket!.write(handshakeRequest);
                    });

                    tlsSocket!.on('data', (data) => {
                        if (data.toString().includes('Sec-WebSocket-Accept')) {
                            resolve(data.toString());
                        }
                    });

                    tlsSocket!.on('error', reject);
                }
            });

            proxySocket.on('error', reject);
        });

        console.log(`TLS Response: ${response}`);
        expect(response.includes('Sec-WebSocket-Accept')).toBeTruthy();

        // Clean up both sockets
        if (tlsSocket) {
            tlsSocket.end();
            tlsSocket.destroy();
        }
        proxySocket.end();
        proxySocket.destroy();
    });
});