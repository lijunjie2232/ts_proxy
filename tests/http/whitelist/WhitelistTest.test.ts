import { HttpProxy } from '../../../src/httpProxy/HttpProxy';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import path from 'path';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';


interface HttpResponse {
    statusCode: number | undefined;
    data: string;
}


describe('HTTP Proxy Server Tests', () => {
    let httpProxy: HttpProxy;
    let logger: Logger;
    let mockServer: http.Server;
    let mockServerPort: number = 3000;

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

    });

    afterAll(async () => {
        await httpProxy.close();
        await mockServer.close();
    });

    test('Should block non-whitelisted client if whitelist is in config ', async () => {
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        expect(response.statusCode).toBe(403);
    });

    test('Should allow to hotpatch the client whitelist and make this hotpatch applicable', async () => {
        httpProxy.configManager.updateClientIpWhitelist(['127.0.0.1']);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(200);
    });

    test('Should allow to any client if no whitelist', async () => {
        httpProxy.configManager.updateClientIpWhitelist([]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(200);
    });

    test('Should allow to hotpatch Client blacklist and make it applicable', async () => {
        httpProxy.configManager.updateClientIpBlackList(["127.0.0.1"]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(403);

        httpProxy.configManager.updateClientIpBlackList([]);

        // Set up the request options for the proxy

        const response2 = await httpRequestAsync(requestOptions);
        console.log(response2)
        expect(response2.statusCode).toBe(200);
    });

    test('Should allow to hotpatch Server blacklist and make it applicable', async () => {
        httpProxy.configManager.updateServerIpBlackList(["localhost"]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(403);
        httpProxy.configManager.updateServerIpBlackList([]);
    });

    test('Should not allow request to non-whitelisted server if server whitelist exist', async () => {
        httpProxy.configManager.updateServerIpWhitelist(["wikipedia.org"]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(403);
    });

    test('Should allow to hotpatch Server whitelist and make it applicable', async () => {
        httpProxy.configManager.updateServerIpWhitelist(["localhost", "wikipedia.org"]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(200);
    });

    test('Should allow any server if no server whitelist', async () => {
        httpProxy.configManager.updateServerIpWhitelist([]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(200);
    });


    test('Should not allow server if in both whitelist and blacklist', async () => {
        httpProxy.configManager.updateServerIpWhitelist(["localhost"]);
        httpProxy.configManager.updateServerIpBlackList(["localhost"]);
        const proxyHost = 'localhost';
        const proxyPort = 1081; // Replace with your proxy server port
        const targetUrl = `http://localhost:${mockServerPort}`; // Replace with a target URL for testing

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

        const response = await httpRequestAsync(requestOptions);
        console.log(response)
        expect(response.statusCode).toBe(403);
        //httpProxy.configManager.persistConfig();
    });



});

function httpRequestAsync(options: http.RequestOptions): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({ statusCode: res.statusCode, data: data });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}