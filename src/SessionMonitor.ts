import * as net from 'net';

export class SessionMonitor {
    private bytesRead: number = 0;
    private bytesWritten: number = 0;
    private lastCheckedTime: number;
    private lastCheckedReadBytes: number = 0;
    private lastCheckedWrittenBytes: number = 0;

    constructor(private clientSocket: net.Socket) {
        this.lastCheckedTime = Date.now();

        const originalWrite = this.clientSocket.write.bind(this.clientSocket);
        this.clientSocket.write = (data: any, ...args: any[]) => {
            //console.log('Overridden write called');
            this.bytesWritten += data instanceof Buffer ? data.length : Buffer.byteLength(data);
            //console.log('Updated bytesWritten:', this.bytesWritten);
            return originalWrite(data, ...args);
        };

        // Handle 'data' event for bytesRead
        this.clientSocket.on('data', (data: Buffer) => {
            this.bytesRead += data.length;
        });
    }

    getCurrentNetworkSpeed() {
        const currentTime = Date.now();
        const timeElapsed = (currentTime - this.lastCheckedTime) / 1000; // Convert to seconds

        const bytesReadSinceLastCheck = this.bytesRead - this.lastCheckedReadBytes;
        const bytesWrittenSinceLastCheck = this.bytesWritten - this.lastCheckedWrittenBytes;

        const readSpeed = bytesReadSinceLastCheck / timeElapsed; // Bytes per second
        const writeSpeed = bytesWrittenSinceLastCheck / timeElapsed; // Bytes per second

        // Update for next check
        this.lastCheckedTime = currentTime;
        this.lastCheckedReadBytes = this.bytesRead;
        this.lastCheckedWrittenBytes = this.bytesWritten;

        return { readSpeed, writeSpeed };
    }

    getTotalSessionBandwidth() {
        return {
            totalRead: this.bytesRead,
            totalWritten: this.bytesWritten
        };
    }

    getBytesRead() {
        return this.bytesRead;
    }

    getBytesWritten() {
        return this.bytesWritten;
    }
}
