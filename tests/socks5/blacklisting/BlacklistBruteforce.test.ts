import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import { loadConfig, saveConfig } from '../../configLoader';
import { promises as fsPromises } from 'fs';
import { SocksServer } from '../../../src/socks5Proxy/SocksServer';
import { ConfigManager } from '../../../src/ConfigManager';
import { LogLevel, LogOutput, Logger }  from '../../../src/Logger';
import path from 'path';

describe('SOCKS5 Proxy Server Tests', () => {
  
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

  test('Should resist brute force attack', async () => {
    const proxyHost = '127.0.0.1';
    const proxyPort = 1080;
    const maxFailedAttempts = 10;
    let blacklisted = false;

    const makeAuthAttempt = async () => {
      return new Promise((resolve, reject) => {
        const client = new net.Socket();
        client.connect(proxyPort, proxyHost, () => {
          client.write(Buffer.from([0x05, 0x01, 0x02]));
          client.once('data', (greetingResponse) => {
            if (greetingResponse[1] !== 0x02) {
              client.destroy();
              return reject(new Error('Server did not select username/password authentication'));
            }
            // Send invalid authentication credentials
            const username = 'invalidUser';
            const password = 'invalidPass';
            const authRequest = Buffer.concat([
              Buffer.from([0x01, username.length]),
              Buffer.from(username),
              Buffer.from([password.length]),
              Buffer.from(password),
            ]);
            client.write(authRequest);

            client.once('data', (authResponse) => {
              client.destroy(); // Always destroy client after handling response
              if (authResponse[1] === 0xFF) {
                blacklisted = true;
                resolve('blacklisted');
              } else {
                resolve('rejected');
              }
            });
          });
        });

        client.on('error', (err) => {
          client.destroy();
          reject(err);
        });

        client.on('close', () => {
          if (!blacklisted) {
            reject(new Error("Connection closed unexpectedly"));
          }
        });
      });
    };

    for (let i = 0; i < maxFailedAttempts; i++) {
      try {
        const result = await makeAuthAttempt();
        if (result === 'blacklisted') {
          blacklisted = true;  // Confirm blacklisting and exit the loop
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between attempts
      } catch (err) {
        const error = err as NodeJS.ErrnoException; // Type assertion, if you are sure about the type
        console.error(`Attempt ${i + 1} failed:`, error.message);
        if (error.code === 'ECONNRESET' && i >= maxFailedAttempts - 2) {
          blacklisted = true;
          break;
        }
      }
    }

    if (!blacklisted) {
      try {
        const finalResult = await makeAuthAttempt();
        expect(finalResult).toBe('blacklisted');  // Assert that the final attempt results in blacklisting
      } catch (err) {
        // Safely type check and access the error
        if (typeof err === "object" && err !== null && 'message' in err) {
          expect((err as Error).message).toMatch(/Connection closed unexpectedly|blacklisted/);
        } else {
          // Handle the case where err does not contain a message or is not an object
          console.error('Unexpected error type:', err);
          expect(err).toBeUndefined(); // Assert something appropriate when err does not meet the expected structure
        }
      }
    } else {
      expect(blacklisted).toBe(true);
    }
  }, 30000);
});