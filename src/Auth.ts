import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Credential } from "./ServerConfigInterface"



// Authentication Method Interface
interface IAuthMethod {
    authenticate(protocol: 'socks5' | 'http', args: any): Promise<boolean>;
}

/*// No Authentication
class NoAuth implements IAuthMethod {

    async authenticate(socket: net.Socket, data: Buffer): Promise<boolean> {
        // No authentication required, always return true
        return true;
    }
}*/

// Username/Password Authentication
class UserPassAuth implements IAuthMethod {
    private validCredentials: Map<string, string>;

    constructor(credentials: Credential[]) {
        this.validCredentials = new Map<string, string>();
        this.loadCredentials(credentials);
    }

    private async loadCredentials(credentials: Credential[]): Promise<void> {
        credentials.forEach(credential => {
            const { username, password } = credential;
            this.validCredentials.set(username, password as string);
        });
    }

    public async authenticate(protocol: 'socks5' | 'http', args: any): Promise<boolean> {
        switch (protocol) {
            case 'socks5':
                return this.authenticateSocks5(args.socket, args.data);
            case 'http':
                return this.authenticateHttp(args.headers);
            default:
                return false;
        }
    }

    private async authenticateSocks5(socket: net.Socket, data: Buffer): Promise<boolean> {
        // Extract username and password from the data buffer
        let result: boolean;
        const usernameLength = data[1]; // Username length at index 0
        const username = data.slice(2, 2 + usernameLength).toString(); // Start from index 1
        const passwordLength = data[2 + usernameLength]; // Password length
        const password = data.slice(3 + usernameLength, 3 + usernameLength + passwordLength).toString(); // Password

        // Check if the credentials are valid
        const storedPassword = this.validCredentials.get(username);
        if (!storedPassword) {
            return false;
        }

        return password === storedPassword;
    }

    private async authenticateHttp(headers: http.IncomingHttpHeaders): Promise<boolean> {
        const authHeader = headers['proxy-authorization'];
        if (!authHeader) {
            return false;
        }

        const encodedCreds = authHeader.split(' ')[1];
        const decodedCreds = Buffer.from(encodedCreds, 'base64').toString();
        const [username, password] = decodedCreds.split(':');

        const storedPassword = this.validCredentials.get(username);

        if (!storedPassword) {
            return false;
        }

        return password === storedPassword;
    }
}

export { IAuthMethod, UserPassAuth };
