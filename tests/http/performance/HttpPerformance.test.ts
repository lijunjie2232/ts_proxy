import * as net from 'net';
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
    let mockServer: http.Server;
    let mockServerPort: number = 3000; // Assign a free port for the mock server

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


    });

    afterAll(async () => {
        await httpProxy.close();
        await mockServer.close();
    });


    test('Should handle 25 concurrent connections', (done) => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}/`; // Replace with a target URL for testing
        const totalConnections = 25;
        let completedConnections = 0;

        const checkCompletion = () => {
            completedConnections++;
            if (completedConnections === totalConnections) {
                done();
            }
        };

        for (let i = 0; i < totalConnections; i++) {
            const requestOptions: http.RequestOptions = {
                host: proxyHost,
                port: proxyPort,
                path: targetUrl,
                method: 'GET',
                headers: {
                    'Host': new URL(targetUrl).hostname
                }
            };

            const req = http.request(requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        expect(res.statusCode).toBe(200);
                        checkCompletion();
                    } catch (error) {
                        done(error);
                    }
                });
            });

            req.on('error', (err) => {
                done(err);
            });

            req.end();
        }
    }, 10000); // Extended timeout to handle multiple connections
});



