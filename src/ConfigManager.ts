import { ServerConfig } from './ServerConfigInterface';
import * as fs from 'fs';
import * as path from 'path';

// Hot-patching will only works on field that are dynamically checked
// Will not work on ports, ip address, credentials, auth method
// Should be used for persisting config (client Blacklist after failed auth notably)

// TO REFACTOR --> Make config attributes private, create getter method and use it in other class to access the ServerConfig attribute
// Update blacklist with setter method. This way ServerConfig are protected against unexpected modifications and only allow for update via specific setter methods

export class ConfigManager {
	private configFilePath: string;
	public config: ServerConfig;

    constructor(configPath: string) {
    	this.configFilePath = configPath;
        this.config = this.loadConfig(configPath);
    }

    public loadConfig(configPath: string): ServerConfig {
        const fullPath = path.resolve(configPath);
        const configData = fs.readFileSync(fullPath, 'utf8');
        return JSON.parse(configData);
    }

	public persistConfig() {
		const fullPath = path.resolve(this.configFilePath);
        const configData = JSON.stringify(this.config, null, 4); // Beautify the JSON output
        fs.writeFileSync(fullPath, configData, 'utf8');
	}

    public updateClientIpBlackList (clientBlacklistedIp: string[]) {
        this.config.clientIpFiltering.blacklist = clientBlacklistedIp;
    }

    public updateClientIpWhitelist (clientWhiteListedIp: string[]) {
        this.config.clientIpFiltering.whitelist = clientWhiteListedIp;
    }

    public updateServerIpBlackList (serverBlacklistedIp: string[]) {
        this.config.serverIpFiltering.blacklist = serverBlacklistedIp;
    }

    public updateServerIpWhitelist (serverWhiteListedIp: string[]) {
        this.config.serverIpFiltering.whitelist = serverWhiteListedIp;
    }

    public getClientIpBlackList () {
        return this.config.clientIpFiltering.blacklist;
    }

    public getClientIpWhitelist () {
        return this.config.clientIpFiltering.whitelist
    }

    public getServerIpBlackList () {
        return this.config.serverIpFiltering.blacklist;
    }

    public getServerIpWhitelist () {
        return this.config.serverIpFiltering.whitelist;
    }

}