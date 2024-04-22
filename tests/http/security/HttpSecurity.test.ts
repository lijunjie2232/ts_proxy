import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { HttpProxy } from '../../../src/httpProxy/HttpProxy';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';


describe('HTTP Proxy Server Tests', () => {
    let httpProxy: HttpProxy;
    let logger: Logger;
    let mockServer: http.Server;
    let mockServerPort: number = 3000; // Assign a free port for the mock server
    let mockHttpsServer: https.Server;
    const mockHttpsServerPort = 3443;

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

        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname,'security_test_server_config.json'));
        saveConfig(path.join(__dirname, 'merged_test_config.json'), testConfig);

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname, "test_server.log"));
        httpProxy = new HttpProxy(path.join(__dirname, "merged_test_config.json"), logger); 
        await httpProxy.start();

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

        // Setup mock HTTPS server
        const options = {
            key: fs.readFileSync(path.join(__dirname, '../../private.key')),
            cert: fs.readFileSync(path.join(__dirname, '../../certificate.crt'))
        };

        mockHttpsServer = https.createServer(options, (req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Hello from mock HTTPS server!');
        });

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


    test('Should allow HTTP request with valid credentials', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}/`; // Replace with a target URL for testing

        // Assuming these are the valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        const requestOptions: http.RequestOptions = {
            host: proxyHost,
            port: proxyPort,
            path: targetUrl,
            method: 'GET',
            headers: {
                'Host': new URL(targetUrl).hostname,
                'Proxy-Authorization': `Basic ${credentials}`
            }
        };

        // Create an HTTP request through the proxy
        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    expect(res.statusCode).toBe(200);
                    done();
                } catch (error) {
                    done(error);
                }
            });
        });

        req.on('error', (err) => {
            done(err);
        });

        req.end();
    });

    test('Should allow HTTPS request with valid credentials', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetHost = 'localhost';
        const targetPort = 3443; 

        // Assuming these are the valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request with Proxy-Authorization to the proxy server
            const connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}\r\nProxy-Authorization: Basic ${credentials}\r\n\r\n`;
            proxySocket.write(connectRequest);
        });

        let tlsSocket: tls.TLSSocket | null = null;

        const cleanupSockets = () => {
            if (tlsSocket) {
                tlsSocket.end();
                tlsSocket.destroy();
                tlsSocket = null;
            }
            proxySocket.end();
            proxySocket.destroy();
        };

        proxySocket.once('data', (chunk) => {
            if (chunk.toString().includes('HTTP/1.1 200 Connection Established')) {
                // Upgrade the connection to TLS for HTTPS
                tlsSocket = tls.connect({ socket: proxySocket, servername: targetHost, rejectUnauthorized: false  }, () => {
                    tlsSocket!.write(`GET / HTTP/1.1\r\nHost: ${targetHost}\r\n\r\n`);
                });

                tlsSocket.once('data', (response) => {
                    if (response.toString().includes('HTTP/1.1 200 OK')) {
                        cleanupSockets();
                        done(); // Request successful
                    } else {
                        cleanupSockets();
                        done(new Error('Failed to establish HTTPS connection'));
                    }
                });

                tlsSocket.on('error', (err) => {
                    cleanupSockets();
                    done(err);
                });
            } else {
                cleanupSockets();
                done(new Error('Proxy authorization failed'));
            }
        });

        proxySocket.on('error', (err) => {
            cleanupSockets();
            done(err);
        });

    }, 15000); // Increased timeout for HTTPS request

    test('Should not allow HTTP request with invalid credentials', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}/`; // Replace with a target URL for testing

        // Invalid credentials
        const invalidCredentials = Buffer.from('invalidUser:invalidPassword').toString('base64');

        const requestOptions: http.RequestOptions = {
            host: proxyHost,
            port: proxyPort,
            path: targetUrl,
            method: 'GET',
            headers: {
                'Host': new URL(targetUrl).hostname,
                'Proxy-Authorization': `Basic ${invalidCredentials}`
            }
        };

        // Create an HTTP request through the proxy
        const req = http.request(requestOptions, (res) => {
            expect(res.statusCode).not.toBe(200);
            res.on('data', () => {}); // Consume response data to complete the response
            res.on('end', () => done());
        });

        req.on('error', (err) => {
            done(err);
        });

        req.end();
    });

    test('Should not allow HTTPS request with invalid credentials', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetHost = 'localhost';
        const targetPort = 3443; 

        // Invalid credentials
        const invalidCredentials = Buffer.from('invalidUser:invalidPassword').toString('base64');

        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request with invalid Proxy-Authorization to the proxy server
            const connectRequest = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}\r\nProxy-Authorization: Basic ${invalidCredentials}\r\n\r\n`;
            proxySocket.write(connectRequest);
        });

        proxySocket.once('data', (chunk) => {
            if (!chunk.toString().includes('HTTP/1.1 200 Connection Established')) {
            	proxySocket.destroy();
                done(); // Expecting the connection not to be established
            } else {
                proxySocket.destroy();
                done(new Error('Proxy authorization should have failed'));
            }
        });

        proxySocket.on('error', (err) => {
            proxySocket.destroy();
            done(err);
        });
    }, 15000);

    test('Should reject invalid request', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        // Create a client socket
        const clientSocket = new net.Socket();
        clientSocket.connect(proxyPort, proxyHost, () => {
            // Send a malformed HTTP request with valid credentials
            clientSocket.write(`GET / HTTP/1.1\r\nHost: \r\nProxy-Authorization: Basic ${credentials}\r\n\r\n`);
        });

        clientSocket.on('data', (data) => {
            expect(data.toString()).toContain('500 Internal Server Error');
            clientSocket.end();
        });

        clientSocket.on('end', () => {
        	clientSocket.destroy();
            done();
        });

        clientSocket.on('error', (err) => {
        	clientSocket.destroy();
            done(err);
        });
    });

    test('Should reject invalid destination', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const invalidHost = 'nonexistent.example.com'; // Non-existent host

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        // Create a client socket
        const clientSocket = new net.Socket();
        clientSocket.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request with valid credentials for a non-existent destination
            clientSocket.write(`CONNECT ${invalidHost}:80 HTTP/1.1\r\nHost: ${invalidHost}\r\nProxy-Authorization: Basic ${credentials}\r\n\r\n`);
        });

        clientSocket.on('data', (data) => {
            expect(data.toString()).toContain('500 Internal Server Error'); // Or appropriate error code/message
            clientSocket.end();
        });

        clientSocket.on('end', () => {
        	clientSocket.destroy();
            done();
        });

        clientSocket.on('error', (err) => {
        	clientSocket.destroy();
            done(err);
        });
    });

    test('Should not allow HTTP request to blacklisted server (request by IPV4)', (done) => {
        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        const requestOptions = {
            host: 'localhost',
            port: 1081, // your proxy server port
            path: 'http://157.240.247.35', // blacklisted IPv4
            method: 'GET',
            headers: {
                'Proxy-Authorization': `Basic ${credentials}`
            }
        };

        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; }); // Ensure all data is read
            res.on('end', () => {
                expect(res.statusCode).toBe(403); // Forbidden
                done();
            });
        });

        req.on('error', (err) => {
            done(err);
        });

        req.end();
    });

    test('Should not allow HTTP request to blacklisted server (request by URL)', (done) => {
        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        const requestOptions = {
            host: 'localhost',
            port: 1081, // your proxy server port
            path: 'http://www.facebook.com', // blacklisted IPv4
            method: 'GET',
            headers: {
                'Proxy-Authorization': `Basic ${credentials}`
            }
        };

        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; }); // Ensure all data is read
            res.on('end', () => {
                expect(res.statusCode).toBe(403); // Forbidden
                done();
            });
        });

        req.on('error', (err) => {
            done(err);
        });

        req.end();
    });

    test('Should not allow HTTPS request to blacklisted server by IPV4', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // your proxy server port
        const blacklistedIPv4 = '157.240.247.35'; // an example blacklisted IPv4 address

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        // Create a TCP connection to the proxy server
        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request for the blacklisted IPv4 address
            const connectRequest = `CONNECT ${blacklistedIPv4}:443 HTTP/1.1\r\n` +
                                   `Host: ${blacklistedIPv4}\r\n` +
                                   `Proxy-Authorization: Basic ${credentials}\r\n\r\n`;
            proxySocket.write(connectRequest);
        });

        proxySocket.once('data', (chunk) => {
            // Check if the proxy server rejects the connection
            expect(chunk.toString()).not.toContain('HTTP/1.1 200 Connection Established');
            proxySocket.destroy();
            done();
        });

        proxySocket.on('error', (err) => {
            proxySocket.destroy();
            done(err);
        });
    }, 15000); // Increased timeout for HTTPS request

    test('Should not allow HTTPS request to blacklisted server by URL', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // your proxy server port
        const blacklistedIPv4 = 'facebook.com'; // an example blacklisted IPv4 address

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');

        // Create a TCP connection to the proxy server
        const proxySocket = net.connect(proxyPort, proxyHost, () => {
            // Send CONNECT request for the blacklisted IPv4 address
            const connectRequest = `CONNECT ${blacklistedIPv4}:443 HTTP/1.1\r\n` +
                                   `Host: ${blacklistedIPv4}\r\n` +
                                   `Proxy-Authorization: Basic ${credentials}\r\n\r\n`;
            proxySocket.write(connectRequest);
        });

        proxySocket.once('data', (chunk) => {
            // Check if the proxy server rejects the connection
            expect(chunk.toString()).not.toContain('HTTP/1.1 200 Connection Established');
            proxySocket.destroy();
            done();
        });

        proxySocket.on('error', (err) => {
            proxySocket.destroy();
            done(err);
        });
    }, 15000); // Increased timeout for HTTPS request

    test('Should not allow more concurrent sessions than maximum session configured', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // your proxy server port
        const maxSessions = 1000;
        let successfulConnections = 0;
        let failedConnections = 0;
        let connections: net.Socket[] = [];

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        const authHeader = `Proxy-Authorization: Basic ${credentials}\r\n`;

        const checkCompletion = () => {
            if (successfulConnections + failedConnections === maxSessions + 1) {
                // Clean up
                connections.forEach(socket => {
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                });
                expect(failedConnections).toBeGreaterThan(0);
                console.log(failedConnections)
                done();
            }
        };

        for (let i = 0; i <= maxSessions; i++) {
            const socket = net.createConnection(proxyPort, proxyHost, () => {
                socket.write(`CONNECT ${proxyHost}:${proxyPort} HTTP/1.1\r\n${authHeader}\r\n`);
            });

            socket.on('data', (data) => {
                if (data.toString().indexOf('HTTP/1.1 200 Connection Established') !== -1) {
                    successfulConnections++;
                } else {
                    failedConnections++;
                }
                checkCompletion();
            });

            socket.on('error', () => {
                failedConnections++;
                checkCompletion();
            });

            connections.push(socket);
        }
    }, 15000); // Increased timeout for creating multiple connections

    test('Should resist DDOS attack', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // your proxy server port
        const requestCount = 1000; // Large number of requests for testing
        let completedRequests = 0;
        let failedRequests = 0;
        let connections: net.Socket[] = [];

        // Valid credentials
        const username = 'user1';
        const password = 'password1';
        const credentials = Buffer.from(`${username}:${password}`).toString('base64');
        const authHeader = `Proxy-Authorization: Basic ${credentials}\r\n`;

        for (let i = 0; i < requestCount; i++) {
            const socket = net.createConnection(proxyPort, proxyHost, () => {
                socket.write(`GET / HTTP/1.1\r\nHost: www.example.com\r\n${authHeader}\r\n`);
            });

            socket.on('data', () => {
                completedRequests++;
                checkCompletion();
            });

            socket.on('error', () => {
                failedRequests++;
                checkCompletion();
            });

            connections.push(socket);
        }

        function checkCompletion() {
            if (completedRequests + failedRequests === requestCount) {
                // Clean up
                connections.forEach(conn => {
                    if (!conn.destroyed) {
                        conn.destroy();
                    }
                });
                expect(failedRequests).toBeLessThan(requestCount);
                done();
            }
        }
    }, 15000); // Increased timeout for the test

});


