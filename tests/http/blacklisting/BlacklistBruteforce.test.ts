import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { HttpProxy } from '../../../src/httpProxy/HttpProxy';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';

describe('HTTP Proxy Server Tests', () => {

    let httpProxy: HttpProxy;
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

        const testConfig = loadConfig(path.join(__dirname, '../../commonTestConfig.json'), path.join(__dirname,'security_test_server_config.json'));
        saveConfig(path.join(__dirname, 'merged_test_config.json'), testConfig);

        const logger = new Logger(LogLevel.Debug, LogOutput.File, path.join(__dirname, "test_server.log"));
        httpProxy = new HttpProxy(path.join(__dirname, "merged_test_config.json"), logger); 
        await httpProxy.start();

    });

    afterAll(async () => {
        await httpProxy.close();
    });

    test('Should resist brute force attack by blacklisting client after 10 failed attempts', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // your proxy server port
        const maxFailedAttempts = 10;
        let failedAttempts = 0;

        // Incorrect credentials
        const username = 'invalidUser';
        const password = 'invalidPassword';
        const invalidCredentials = Buffer.from(`${username}:${password}`).toString('base64');

        const attemptConnection = () => {
            const socket = net.createConnection(proxyPort, proxyHost, () => {
                socket.write(`CONNECT example.com:80 HTTP/1.1\r\n` +
                             `Proxy-Authorization: Basic ${invalidCredentials}\r\n\r\n`);
            });

            socket.on('data', (data) => {
                if (data.toString().indexOf('HTTP/1.1 401') !== -1) {
                    failedAttempts++;
                    socket.destroy();
                    if (failedAttempts < maxFailedAttempts) {
                        attemptConnection();
                    } else {
                        // Make one more attempt to confirm blacklisting
                        const testSocket = net.createConnection(proxyPort, proxyHost, () => {
                            testSocket.write(`CONNECT www.example.com:80 HTTP/1.1\r\n` +
                                             `Proxy-Authorization: Basic ${invalidCredentials}\r\n\r\n`);
                        });

                        testSocket.on('data', (testData) => {
                            expect(testData.toString()).toContain('HTTP/1.1 403 Forbidden');
                            testSocket.destroy();
                            done();
                        });

                        testSocket.on('error', (err) => {
                            testSocket.destroy();
                            done(err);
                        });
                    }
                }
            });

            socket.on('error', (err) => {
                socket.destroy();
                done(err);
            });
        };

        attemptConnection();
    }, 60000); // Increased timeout for multiple attempts
});

