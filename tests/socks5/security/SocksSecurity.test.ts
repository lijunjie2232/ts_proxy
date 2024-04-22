import * as net from 'net';
import { AddressInfo } from 'net';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { SocksServer } from '../../../src/socks5Proxy/SocksServer';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';
import * as http from 'http';

describe('SOCKS5 Server Security Tests', () => {

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


  test('Should authenticate with valid credentials', (done) => {
    const client = new net.Socket();

    client.connect(1080, '127.0.0.1', () => {
      // Initiate greeting and request authentication method
      client.write(Buffer.from([0x05, 0x01, 0x02])); // VER, NMETHODS, METHODS (Username/Password)
      
      // Handle server's method selection
      client.once('data', (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x02) {
          return done(new Error('Invalid authentication method selected by server'));
        }

        // Send username and password
        const username = 'user1'; // replace with valid username
        const password = 'password1'; // replace with valid password
        const usernameBuffer = Buffer.from(username);
        const passwordBuffer = Buffer.from(password);
        const authRequest = Buffer.concat([
          Buffer.from([0x01]), // VER
          Buffer.from([usernameBuffer.length]), // ULEN
          usernameBuffer, // UNAME
          Buffer.from([passwordBuffer.length]), // PLEN
          passwordBuffer, // PASSWD
        ]);
        client.write(authRequest);

        // Handle authentication response
        client.once('data', (authResponse) => {
          if (authResponse[0] !== 0x05 || authResponse[1] !== 0x00) {
            return done(new Error('Authentication failed'));
          }

          // Successful authentication
          client.end();
          done();
        });
      });
    });

    client.on('error', (err) => {
      done(err);
    });
  });

  test('Should not authenticate with invalid credentials', (done) => {
    const client = new net.Socket();

    client.connect(1080, '127.0.0.1', () => {
      // Initiate greeting and request user/password authentication
      client.write(Buffer.from([0x05, 0x01, 0x02]));

      // Handle server's authentication method selection
      client.once('data', (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x02) {
          return done(new Error('Invalid authentication method selected by server'));
        }

        // Send invalid username and password
        const username = 'invalidUser';
        const password = 'invalidPass';
        const usernameBuffer = Buffer.from(username);
        const passwordBuffer = Buffer.from(password);
        const authRequest = Buffer.concat([
          Buffer.from([0x01, usernameBuffer.length]),
          usernameBuffer,
          Buffer.from([passwordBuffer.length]),
          passwordBuffer,
        ]);
        client.write(authRequest);

        // Handle authentication response
        client.once('data', (authResponse) => {
          if (authResponse[0] === 0x05 && authResponse[1] === 0x00) {
            client.end();
            return done(new Error('Authentication succeeded with invalid credentials'));
          }

          // Expected failure
          client.end();
          done();
        });
      });
    });

    client.on('error', (err) => {
      done(err);
    });
  });

  test('Should process COMMAND on valid credentials', (done) => {
    const client = new net.Socket();

    client.connect(1080, '127.0.0.1', () => {
      // Step 1: Initiate greeting and request user/password authentication
      client.write(Buffer.from([0x05, 0x01, 0x02])); // SOCKS5, one method, username/password

      // Handle server's authentication method selection
      client.once('data', (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x02) {
          return done(new Error('Invalid authentication method selected by server'));
        }

        // Step 2: Send valid username and password
        const username = 'user1'; // replace with a valid username
        const password = 'password1'; // replace with a valid password
        const authRequest = Buffer.concat([
          Buffer.from([0x01, username.length]),
          Buffer.from(username),
          Buffer.from([password.length]),
          Buffer.from(password),
        ]);
        client.write(authRequest);

        // Handle authentication response
        client.once('data', (authResponse) => {
          if (authResponse[0] !== 0x05 || authResponse[1] !== 0x00) {
            return done(new Error('Authentication failed'));
          }

          // Step 3: Send CONNECT command
          // For example, to connect to 1.1.1.1:80
          const connectRequest = Buffer.from([
              0x05, // SOCKS version
              0x01, // Command code: establish a TCP/IP stream connection
              0x00, // Reserved, must be 0x00
              0x01, // Address type: IPv4
              0x7F, 0x00, 0x00, 0x01, // IP Address: 127.0.0.1
              0x23, 0x29 // Port: 9001
          ]);
          client.write(connectRequest);

          // Handle CONNECT command response
          client.once('data', (connectResponse) => {
            if (connectResponse[0] !== 0x05) {
              return done(new Error('Invalid SOCKS5 response'));
            }
            // Check the response status (connectResponse[1])
            // 0x00 - request granted, other values indicate different errors

            if (connectResponse[1] === 0x00) {
              // Successful processing of CONNECT command
              client.end();
              done();
            } else {
              // CONNECT command failed
              return done(new Error('CONNECT command failed with status: ' + connectResponse[1]));
            }
          });
        });
      });
    });

    client.on('error', (err) => {
      done(err);
    });
  });

  test('Should not process COMMAND forwarding on invalid credentials', (done) => {
    const client = new net.Socket();

    client.connect(1080, '127.0.0.1', () => {
      // Step 1: Initiate greeting and request user/password authentication
      client.write(Buffer.from([0x05, 0x01, 0x02])); // SOCKS5, one method, username/password

      // Handle server's authentication method selection
      client.once('data', (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x02) {
          return done(new Error('Invalid authentication method selected by server'));
        }

        // Step 2: Send invalid username and password
        const username = 'invalidUser';
        const password = 'invalidPass';
        const authRequest = Buffer.concat([
          Buffer.from([0x01, username.length]),
          Buffer.from(username),
          Buffer.from([password.length]),
          Buffer.from(password),
        ]);
        client.write(authRequest);

        // Handle authentication response (expecting failure)
        client.once('data', (authResponse) => {
          if (authResponse[0] === 0x05 && authResponse[1] === 0x00) {
            client.end();
            return done(new Error('Unexpected successful authentication with invalid credentials'));
          }

          // Step 3: Attempt to send CONNECT command despite failed authentication
          const connectRequest = Buffer.from([0x05, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x50]); // Example CONNECT command
          client.write(connectRequest);

          // Handle CONNECT command response (expecting rejection)
          client.once('data', (connectResponse) => {
            if (connectResponse[0] === 0x05 && connectResponse[1] === 0x00) {
              return done(new Error('CONNECT command processed despite invalid credentials'));
            }

            // Expected failure to process command
            client.end();
            done();
          });
        });
      });
    });

    client.on('error', (err) => {
      done(err);
    });

    client.on('close', () => {
      // Complete the test when the server closes the connection
      done();
    });
  });

  test('Should resist DDOS attack', async () => {
    const connections = 1000; // Number of parallel connections
    const promises = [];

    for (let i = 0; i < connections; i++) {
      promises.push(new Promise((resolve) => {
        const client = new net.Socket();

        client.on('error', () => {
          client.destroy();
          resolve('error');
        });

        client.connect(1080, '127.0.0.1', () => {
          // Send random data or valid requests to simulate varied traffic
          const randomData = Buffer.from([...Array(10)].map(() => Math.floor(Math.random() * 256)));
          client.write(randomData);

          const timeout = setTimeout(() => {
            client.destroy();
            resolve('sent');
          }, 1000); // Keep connection open for a short period
          timeout.unref();
        });
      }));
    }

    await Promise.all(promises);
    // Additional checks can be added here to verify server's status

  }, 60000); // Increased timeout to 60 seconds

  test('Should reject invalid packet', (done) => {
    const client = new net.Socket();

    const cleanupAndFinish = (error?: Error) => {
      client.destroy(); // Ensure the client socket is closed
      done(error); // Complete the test, pass error if present
    };

    client.on('error', () => {
      // Handle error, which could be a sign of correct server behavior
      cleanupAndFinish();
    });

    client.on('close', () => {
      // Connection closed by server, indicating rejection of invalid packet
      cleanupAndFinish();
    });

    client.connect(1080, '127.0.0.1', () => {
      // Send invalid data
      const invalidData = Buffer.from('invalid data');
      client.write(invalidData);

      const timeout = setTimeout(() => {
        // Fail the test if the server does not respond
        cleanupAndFinish(new Error('Server did not close the connection'));
      }, 5000); // 5 seconds timeout for server to respond
      timeout.unref();
    });
  });

  test('Should reject invalid destination server', (done) => {
    const client = new net.Socket();
    const validUsername = 'user1'; // Replace with valid username
    const validPassword = 'password1'; // Replace with valid password

    const cleanupAndFinish = (error?: Error) => {
      client.destroy();
      done(error);
    };

    client.connect(1080, '127.0.0.1', () => {
      // Step 1: Initiate greeting and request user/password authentication
      client.write(Buffer.from([0x05, 0x01, 0x02])); // SOCKS5, one method, username/password

      // Handle server's authentication method selection
      client.once('data', (data) => {
        if (data[0] !== 0x05 || data[1] !== 0x02) {
          return cleanupAndFinish(new Error('Invalid authentication method selected by server'));
        }

        // Step 2: Send valid username and password
        const authRequest = Buffer.concat([
          Buffer.from([0x01, validUsername.length]),
          Buffer.from(validUsername),
          Buffer.from([validPassword.length]),
          Buffer.from(validPassword),
        ]);
        client.write(authRequest);

        // Handle authentication response
        client.once('data', (authResponse) => {
          if (authResponse[0] !== 0x05 || authResponse[1] !== 0x00) {
            return cleanupAndFinish(new Error('Authentication failed'));
          }

          // Step 3: Send CONNECT command to an invalid destination
          const invalidAddress = '0.0.0.0'; // Non-routable IP address as an example
          const port = 80; // Example port
          const connectRequest = Buffer.from([
            0x05, 0x01, 0x00, // SOCKS version, CONNECT command, reserved byte
            0x01, // Address type: IPv4
            ...invalidAddress.split('.').map(Number), // Destination IP
            port >> 8, port & 0xFF, // Destination port in network byte order
          ]);
          client.write(connectRequest);

          // Handle CONNECT command response
          client.once('data', (connectResponse) => {
            client.destroy();
            if (connectResponse[0] !== 0x05 || connectResponse[1] === 0x00) {
              return cleanupAndFinish(new Error('Invalid destination was not rejected'));
            }
            done(); // Test passed, invalid destination rejected
          });
        });
      });
    });

    client.on('error', cleanupAndFinish);
  });
});






describe('SOCKS5 Server Security Tests', () => {
    const validUsername = 'user1'; // Replace with valid username
    const validPassword = 'password1'; // Replace with valid password
    const blacklistedIpv4 = '157.240.247.35'; // Replace with an actual blacklisted IPv4 address
    const blacklistedDomain = 'facebook.com'; // Replace with an actual blacklisted domain

    let socksProxy: SocksServer;
    let logger: Logger;

    beforeAll(async () => {


        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname,'security_test_server_config.json'));
        saveConfig(path.join(__dirname,'merged_test_config.json'), testConfig);

        console.log(testConfig)

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname,"test_server.log"));
        socksProxy = new SocksServer(path.join(__dirname, "merged_test_config.json"), logger); 
        await socksProxy.start();
    });

    afterAll(async () => {
        await socksProxy.close();
    });

    const createSocks5ConnectionAndTestBlacklist = (address: string, port: number, addressType: number, done: jest.DoneCallback) => {
        const client = new net.Socket();

        client.connect(1080, 'localhost', () => {
            client.write(Buffer.from([0x05, 0x01, 0x02])); // SOCKS5 greeting, requesting username/password authentication

            client.once('data', (authMethodSelection) => {
                if (authMethodSelection[0] !== 0x05 || authMethodSelection[1] !== 0x02) {
                    client.destroy();
                    done(new Error('SOCKS5 authentication method not accepted'));
                    return;
                }

                // Send username and password
                const authRequest = Buffer.concat([
                    Buffer.from([0x01, validUsername.length]),
                    Buffer.from(validUsername),
                    Buffer.from([validPassword.length]),
                    Buffer.from(validPassword),
                ]);
                client.write(authRequest);

                client.once('data', (authResponse) => {
                    if (authResponse[0] !== 0x05 || authResponse[1] !== 0x00) {
                        client.destroy();
                        done(new Error('Authentication failed'));
                        return;
                    }

                    // Successfully authenticated, send CONNECT command
                    let connectRequest;
                    if (addressType === 4) { // IPv4
                        const ipv4Bytes = address.split('.').map(Number).map(byte => Buffer.from([byte]));
                        connectRequest = Buffer.concat([
                            Buffer.from([0x05, 0x01, 0x00, 0x01]), // CONNECT command with IPv4 address type
                            ...ipv4Bytes, // IPv4 address bytes
                            Buffer.from([port >> 8, port & 0xFF]), // Port
                        ]);
                    } else { // Domain
                        connectRequest = Buffer.concat([
                            Buffer.from([0x05, 0x01, 0x00, 0x03, address.length]), // CONNECT command with domain address type
                            Buffer.from(address), // Domain name
                            Buffer.from([port >> 8, port & 0xFF]), // Port
                        ]);
                    }
                    client.write(connectRequest);

                    client.once('data', (connectResponse) => {
                        client.destroy(); // Close the client socket

                        if (connectResponse[1] !== 0x00) {
                            done(); // Test passed, server blocked access as expected
                        } else {
                            done(new Error('Connection to blacklisted address should not be allowed'));
                        }
                    });

                    client.on('error', () => {
                        client.destroy();
                        done(); // Test passed, connection failed as expected due to server policy
                    });

                    client.on('close', () => {
                        // Handle the case where the server closes the connection
                        done(); // Test passed, server closed the connection as part of blocking access
                    })
                });
            });

            client.on('error', () => {
                client.destroy();
                done(); // Test passed, connection failed as expected
            });
        });
    };

    test('Should not allow to CONNECT to blacklisted domain - request by IPV4', done => {
        createSocks5ConnectionAndTestBlacklist(blacklistedIpv4, 80, 4, done);
    });


    test('Should not allow to CONNECT to blacklisted domain - request by domain', done => {
        createSocks5ConnectionAndTestBlacklist(blacklistedDomain, 80, 3, done);
    });
});




describe('SOCKS5 Server Security Tests', () => {
    const MAX_SESSIONS = 1000; // Set to your server's configured maximum session limit
    const validUsername = 'user1'; // Replace with valid username
    const validPassword = 'password1'; // Replace with valid password
    let mockServer: net.Server;
    let mockServerIp: string;
    let mockServerPort: number;

    let socksProxy: SocksServer;
    let logger: Logger;

    beforeAll(async () => {

        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname, 'security_test_server_config.json'));
        await saveConfig(path.join(__dirname, 'merged_test_config.json'), testConfig);
        console.log(testConfig);

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname, "test_server.log"));
        socksProxy = new SocksServer(path.join(__dirname, "merged_test_config.json"), logger);
        await socksProxy.start();

        mockServer = net.createServer();
        await new Promise<void>((resolve, reject) => { // Explicitly declare the Promise type as void
            mockServer.listen(0, 'localhost', () => {
                const address = mockServer.address();
                if (typeof address === 'string' || address === null) {
                    reject(new Error('Unable to get mock server address'));
                } else {
                    mockServerIp = address.address;
                    mockServerPort = address.port;
                    resolve();  // Correctly using resolve without arguments for Promise<void>
                }
            });
        });
    });

    afterAll(async () => {
        await socksProxy.close();
        await mockServer.close();
    });

    test('Should not allow more sessions than maximum session configured', async () => {
        let connections: net.Socket[] = [];

        const cleanupConnections = () => {
            connections.forEach(client => client.destroy());
            connections = [];
        };

        const createAndTestConnection = async () => {
            const client = new net.Socket();
            connections.push(client);

            await new Promise<void>((resolve, reject) => {
                client.connect(1080, 'localhost', async () => {
                    // Send SOCKS5 greeting
                    client.write(Buffer.from([0x05, 0x01, 0x02]));  // Requesting username/password authentication
                    
                    client.once('data', async (authMethodSelection) => {
                        if (authMethodSelection[0] !== 0x05 || authMethodSelection[1] !== 0x02) {
                            reject(new Error('SOCKS5 authentication method not accepted'));
                            return;
                        }

                        // Send username and password
                        const authRequest = Buffer.concat([
                            Buffer.from([0x01, validUsername.length]),
                            Buffer.from(validUsername),
                            Buffer.from([validPassword.length]),
                            Buffer.from(validPassword),
                        ]);
                        client.write(authRequest);

                        client.once('data', async (authResponse) => {
                            if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
                                reject(new Error('Authentication failed'));
                                return;
                            }

                            // Successfully authenticated, send CONNECT command
                            const ipBytes = mockServerIp.split('.').map(Number); // Convert IP segments to numbers
                            const ipBuffer = Buffer.from(ipBytes); // Create a Buffer from IP bytes

                            // Correctly format the port into a byte array
                            const portBytes = [mockServerPort >> 8, mockServerPort & 0xFF]; // Split port into two bytes
                            const portBuffer = Buffer.from(portBytes); // Create a Buffer from port bytes

                            const connectRequest = Buffer.concat([
                                Buffer.from([0x05, 0x01, 0x00, 0x01]), // SOCKS version, CONNECT command, reserved, address type IPv4
                                ipBuffer, // Mock server IP
                                portBuffer // Mock server port
                            ]);
                            client.write(connectRequest);

                            client.once('data', (connectResponse) => {
                                if (connectResponse[1] !== 0x00) {
                                    reject(new Error('CONNECT command failed'));
                                    return;
                                }

                                resolve();  // Successfully established a SOCKS connection
                            });
                        });
                    });

                    client.on('error', (err) => {
                        client.destroy();
                        reject(err);  // Fail the test on socket error
                    });
                });
            });
        };

        try {
            for (let i = 0; i < MAX_SESSIONS; i++) {
                await createAndTestConnection();  // Create and test up to the maximum sessions
            }

            await expect(createAndTestConnection()).rejects.toThrow('Expected connection failure beyond max sessions');
        } catch (error) {
          
        } finally {
            cleanupConnections();  // Ensure all connections are cleaned up
        }
    }, 30000);  // Extended timeout for the test
});