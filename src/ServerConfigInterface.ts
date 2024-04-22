export interface Credential {
    username: string;
    password: string;
};

export interface ServerConfig {
    authentication: {
        method: "password" | "noauth";
        maxFailedAttempts: number; // New field for max failed authentication attempts
    };
    server: {
        socks5: {
            serverIP: string;
            port: number;
            udpPortRange: {
                min: number;
                max: number;
                
            };
        };
        http: {
            serverIP: string;
            port: number;            
        };
        maxConcurrentConnections: number;
    };
    credentials: Credential[];
    clientIpFiltering: { // Filtering can be done by IPV4, IPV6 and domain (recommended to do all)
        blacklist: string[];
        whitelist?: string[]; // Optional whitelist for client IP filtering
    };
    serverIpFiltering: {
        blacklist: string[];
        whitelist?: string[]; // Optional whitelist for server IP filtering
    };
};