# TS Proxy

HTTP/HTTPS/SOCKS5 proxy server, written in Typescript.

Implementation match almost completely with RFC 1928 specification (https://datatracker.ietf.org/doc/html/rfc1928), except for error messages that are not all properly implemented.

## Features

- Support all SOCKS5 command (CONNECT, BIND, UDP ASSOCIATE)
- Support HTTP & HTTPS (and websocket)
- Password-based authentication (not secured, stored in plain text. Also authentication packet are not encrypted)
- Client & distant server whitelist/blacklisting
- Limit number of concurrent connections
- Limit number of failed authentication

## Usage

### Installation

**Install from NPM**
```
npm install ts_proxy
```

**From the source**

1. Install npm and node > 15.0.0
2. Download the repo
3. In the repo root folder run ```npm install```
4. You can then launch ```npm test``` to check that all is fine
5. Build to js using ```npm run build```
6. (Optional) Run ```npm link``` in the root folder of the repo to be able to start the server outside of the repo

### Configuration

Configuration of the server is managed by a .json file, example below 

```
{
   "server":{
      "socks5":{
         "serverIP":"127.0.0.1",
         "port":1080,
         "udpPortRange":{
            "min":49152,
            "max":65535
         }
      },
      "http":{
         "serverIP":"127.0.0.1",
         "port":1081
      },
      "maxConcurrentConnections":1000
   },
   "authentication":{							
      "method":"password",						
      "maxFailedAttempts":10 					
   },
   "credentials":[								
      {
         "username":"user1",
         "password":"password1"
      }
   ],
   "clientIpFiltering":{ 						
      "blacklist":[],
      "whitelist":["192.165.1.12"]
   },
   "serverIpFiltering":{						
      "blacklist":[],
      "whitelist":[]
   }
}
```

- serverIP : Define the IP on which the proxy server will be listening
- udpPortRange : Define the range of port that can be allocated for UDP
- authentication.method :  Define the authentication method, possible values : "noauth", "password"
- authentication.maxFailedAttempts :  Define the maximum number of failed authentication attemps before being blacklisted
- credentials : Define the user(s) credentials (not required if you choosed "noauth" for authentication method)
- clientIpFiltering : Define blacklist and whitelist for client IP (domain can also be used)
- serverIpFiltering : Define blacklist and whitelist for distant server IP (domain can also be used)


### Launch the server

You can start the proxy server(s) with the command ```ts_proxy```, possible arguments are the following : 

--config_path : Indicate the path of the server config file, default to server-config.json in root directory of ts_proxy

--log_level : Indicate the level for logging (Debug, Info, Warn, Error, None)

--log_output : Specify if the logger output goes to the console, to a log file or to both (Console, File, Both)

--log_file_path : Specifiy the path the logger output file, default is server-log.txt in root directory of ts_proxy

--http : Run HTTP/HTTPS proxy server along the SOCKS5 proxy server

## Further improvments

- Fix the open handle in tests\http\functional (on websocket test cases)
- Implement all error messages in RFC 1928 + improve error management
- Support IPV6
- Improve authentication & security
- Support server & session monitoring via HTTP endpoint
- Add management layer to start/stop/monitor multiple proxy servers

## Meta

Yacine BEKKA – [Linkedin](https://www.linkedin.com/in/yacine-bekka-519b79146) – yacinebekka@yahoo.fr

Distributed under MIT license. See ``LICENSE`` for more information.
