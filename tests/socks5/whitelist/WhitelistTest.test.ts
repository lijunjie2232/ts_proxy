import { SocksServer } from '../../../src/socks5Proxy/SocksServer';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import path from 'path';

interface HttpResponse {
    statusCode: number | undefined;
    data: string;
}


describe('SOCKS5 Proxy Server Tests', () => {
    let socksProxy: SocksServer;
    let logger: Logger;
    const mockServerPort = 9001; // Port for the mock TCP server
    let mockServer: net.Server; 

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
        saveConfig(path.join(__dirname,'merged_test_config.json'), testConfig);


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

    test('Should not reply SOCKS5 greeting if whitelist exist and client not in it', (done) => {
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port

        // Create a socket connection to the SOCKS5 proxy
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            // Construct and send the SOCKS5 greeting message
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);
        });

        proxySocket.on('data', (data) => {
            // If any data is received, the test should fail
            done(new Error('Expected no data response from the server'));
        });

        proxySocket.on('error', (err) => {
            done(err);
        });

        proxySocket.on('close', () => {
            // The test passes if the socket closes without receiving any data
            done();
        });
    });

    test('Should send SOCKS5 greeting if client in whitelist after hotpatching client whitelist', (done) => {
        socksProxy.configManager.updateClientIpWhitelist(['127.0.0.1']);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port

        // Create a socket connection to the SOCKS5 proxy
        const proxySocket = new net.Socket();

        const cleanUpAndFinish = (error?: unknown) => {
            proxySocket.destroy();
            if (error) {
                done(error instanceof Error ? error : new Error(`Unknown error: ${error}`));
            } else {
                done();
            }
        };

        proxySocket.connect(proxyPort, proxyHost, () => {
            // Construct and send the SOCKS5 greeting message
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            // Receive the proxy's response
            proxySocket.once('data', (data) => {
                try {
                    // Expecting a response indicating no authentication is required
                    expect(data[0]).toBe(0x05); // SOCKS version
                    expect(data[1]).toBe(0x00); // No authentication required
                    cleanUpAndFinish();
                } catch (error) {
                    cleanUpAndFinish(error);
                }
            });
        });

        proxySocket.on('error', (err) => {
            cleanUpAndFinish(err);
        });

        proxySocket.on('close', () => {
            cleanUpAndFinish();
        });
    });

    test('Should send SOCKS5 greeting for any client if no whitelist', (done) => {
        socksProxy.configManager.updateClientIpWhitelist([]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port

        // Create a socket connection to the SOCKS5 proxy
        const proxySocket = new net.Socket();

        const cleanUpAndFinish = (error?: unknown) => {
            proxySocket.destroy();
            if (error) {
                done(error instanceof Error ? error : new Error(`Unknown error: ${error}`));
            } else {
                done();
            }
        };

        proxySocket.connect(proxyPort, proxyHost, () => {
            // Construct and send the SOCKS5 greeting message
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            // Receive the proxy's response
            proxySocket.once('data', (data) => {
                try {
                    // Expecting a response indicating no authentication is required
                    expect(data[0]).toBe(0x05); // SOCKS version
                    expect(data[1]).toBe(0x00); // No authentication required
                    cleanUpAndFinish();
                } catch (error) {
                    cleanUpAndFinish(error);
                }
            });
        });

        proxySocket.on('error', (err) => {
            cleanUpAndFinish(err);
        });

        proxySocket.on('close', () => {
            cleanUpAndFinish();
        });
    });

    test('Should allow hotpatch client blacklist and make it applicable', (done) => {
        socksProxy.configManager.updateClientIpBlackList(["127.0.0.1"]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port

        // Create a socket connection to the SOCKS5 proxy
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            // Construct and send the SOCKS5 greeting message
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);
        });

        proxySocket.on('data', (data) => {
            // If any data is received, the test should fail
            done(new Error('Expected no data response from the server'));
        });

        proxySocket.on('error', (err) => {
            done(err);
        });

        proxySocket.on('close', () => {
            // The test passes if the socket closes without receiving any data
            done();
        });
    });

    test('Should allow hotpatch server blacklist and make it applicable', (done) => {
        socksProxy.configManager.updateClientIpBlackList([]);
        socksProxy.configManager.updateServerIpBlackList(["localhost"]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port
        const googleHost = 'localhost';
        const googlePort = 9001; // HTTP port
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            proxySocket.once('data', (greetingResponse) => {
                console.log(greetingResponse)
                if (greetingResponse[1] !== 0x00) { // Checking for 'no authentication required'
                    done(new Error('SOCKS5 authentication method not accepted by the proxy'));
                    return;
                }
                const requestBuffer = Buffer.from([
                    0x05, // SOCKS version
                    0x01, // Command code: establish a TCP/IP stream connection
                    0x00, // Reserved
                    0x03, // Address type: DOMAINNAME
                    googleHost.length, // Address length
                    ...Buffer.from(googleHost), // Address
                    googlePort >> 8, // Target port (first 8 bits)
                    googlePort & 0xff // Target port (last 8 bits)
                ]);

                proxySocket.write(requestBuffer);

                proxySocket.on('data', (data) => {
                    console.log(data)
                    done(new Error('Expected no data response from the server'));
                });
            });
        });

        proxySocket.on('error', (err) => {
            done(err);
        });

        proxySocket.on('close', () => {
            done();
        });
    });

    test('Should not allow request to non-whitelisted server if server whitelist exist', (done) => {
        socksProxy.configManager.updateServerIpBlackList([]);
        socksProxy.configManager.updateServerIpWhitelist(["google.com"]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port
        const googleHost = 'localhost';
        const googlePort = 9001; // HTTP port
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            proxySocket.once('data', (greetingResponse) => {
                console.log(greetingResponse)
                if (greetingResponse[1] !== 0x00) { // Checking for 'no authentication required'
                    done(new Error('SOCKS5 authentication method not accepted by the proxy'));
                    return;
                }
                const requestBuffer = Buffer.from([
                    0x05, // SOCKS version
                    0x01, // Command code: establish a TCP/IP stream connection
                    0x00, // Reserved
                    0x03, // Address type: DOMAINNAME
                    googleHost.length, // Address length
                    ...Buffer.from(googleHost), // Address
                    googlePort >> 8, // Target port (first 8 bits)
                    googlePort & 0xff // Target port (last 8 bits)
                ]);

                proxySocket.write(requestBuffer);

                proxySocket.on('data', (data) => {
                    console.log(data)
                    done(new Error('Expected no data response from the server'));
                });
            });
        });

        proxySocket.on('error', (err) => {
            done(err);
        });

        proxySocket.on('close', () => {
            done();
        });
    });


    test('Should allow request to server in whitelist if whitelist exist', (done) => {
        socksProxy.configManager.updateServerIpBlackList([]);
        socksProxy.configManager.updateServerIpWhitelist(["google.com","wikipedia.org"]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port
        const googleHost = 'localhost';
        const googlePort = 9001; // HTTP port
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            proxySocket.once('data', (greetingResponse) => {
                console.log(greetingResponse)
                if (greetingResponse[1] !== 0x00) { // Checking for 'no authentication required'
                    done(new Error('SOCKS5 authentication method not accepted by the proxy'));
                    return;
                }
                const requestBuffer = Buffer.from([
                    0x05, // SOCKS version
                    0x01, // Command code: establish a TCP/IP stream connection
                    0x00, // Reserved
                    0x03, // Address type: DOMAINNAME
                    googleHost.length, // Address length
                    ...Buffer.from(googleHost), // Address
                    googlePort >> 8, // Target port (first 8 bits)
                    googlePort & 0xff // Target port (last 8 bits)
                ]);

                proxySocket.write(requestBuffer);

                proxySocket.once('data', (connectResponse) => {
                    console.log('Connect Response:', connectResponse);
                    // Expected response format: [VERSION, STATUS, RESERVED, ADDRESS TYPE, ...]
                    if (connectResponse.length >= 2 && connectResponse[1] === 0x00) {
                        // Connection established successfully
                        done();
                    } else {                    
                        // Connection failed
                        done(new Error('Connection failed or invalid response from SOCKS5 proxy'));
                    }
                    proxySocket.end();
                     // Close the socket
                });

                proxySocket.on('error', (err) => {
                    done(err);
                });

                proxySocket.on('close', () => {
                    done();
                });
            });
        });
    });

    test('Should allow request to any server if whitelist exist', (done) => {
        socksProxy.configManager.updateServerIpWhitelist([]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port
        const googleHost = 'localhost';
        const googlePort = 9001; // HTTP port
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            proxySocket.once('data', (greetingResponse) => {
                console.log(greetingResponse)
                if (greetingResponse[1] !== 0x00) { // Checking for 'no authentication required'
                    done(new Error('SOCKS5 authentication method not accepted by the proxy'));
                    return;
                }
                const requestBuffer = Buffer.from([
                    0x05, // SOCKS version
                    0x01, // Command code: establish a TCP/IP stream connection
                    0x00, // Reserved
                    0x03, // Address type: DOMAINNAME
                    googleHost.length, // Address length
                    ...Buffer.from(googleHost), // Address
                    googlePort >> 8, // Target port (first 8 bits)
                    googlePort & 0xff // Target port (last 8 bits)
                ]);

                proxySocket.write(requestBuffer);

                proxySocket.once('data', (connectResponse) => {
                    console.log('Connect Response:', connectResponse);
                    // Expected response format: [VERSION, STATUS, RESERVED, ADDRESS TYPE, ...]
                    if (connectResponse.length >= 2 && connectResponse[1] === 0x00) {
                        // Connection established successfully
                        done();
                    } else {
                                                // Connection failed
                        done(new Error('Connection failed or invalid response from SOCKS5 proxy'));
                    }
                    proxySocket.end();

                     // Close the socket
                });

                proxySocket.on('error', (err) => {
                    done(err);
                });

                proxySocket.on('close', () => {
                    done();
                });
            });
        });
    });


    test('Should allow request to any server if whitelist exist', (done) => {
        socksProxy.configManager.updateServerIpWhitelist(["wikipedia.org"]);
        socksProxy.configManager.updateServerIpBlackList(["wikipedia.org"]);
        const proxyHost = 'localhost'; // SOCKS5 proxy host
        const proxyPort = 1080;        // SOCKS5 proxy port
        const googleHost = 'localhost';
        const googlePort = 9001; // HTTP port
        const proxySocket = new net.Socket();

        proxySocket.connect(proxyPort, proxyHost, () => {
            const socks5Greeting = Buffer.from([
                0x05, // SOCKS version (5 for SOCKS5)
                0x01, // Number of authentication methods supported
                0x00  // No authentication required
            ]);

            proxySocket.write(socks5Greeting);

            proxySocket.once('data', (greetingResponse) => {
                console.log(greetingResponse)
                if (greetingResponse[1] !== 0x00) { // Checking for 'no authentication required'
                    done(new Error('SOCKS5 authentication method not accepted by the proxy'));
                    return;
                }
                const requestBuffer = Buffer.from([
                    0x05, // SOCKS version
                    0x01, // Command code: establish a TCP/IP stream connection
                    0x00, // Reserved
                    0x03, // Address type: DOMAINNAME
                    googleHost.length, // Address length
                    ...Buffer.from(googleHost), // Address
                    googlePort >> 8, // Target port (first 8 bits)
                    googlePort & 0xff // Target port (last 8 bits)
                ]);

                proxySocket.write(requestBuffer);

                proxySocket.on('data', (data) => {
                    console.log(data)
                    done(new Error('Expected no data response from the server'));
                });

                proxySocket.on('error', (err) => {
                    done(err);
                });

                proxySocket.on('close', () => {
                    done();
                });
            });
        });
    });



});

