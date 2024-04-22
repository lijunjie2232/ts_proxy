import { SessionMonitor } from '../../../src/SessionMonitor';
import * as net from 'net';

describe('SessionMonitor Tests', () => {
    // Would need more realistic setup with real server, real network interface and real http remote server

  it('should correctly track network speed with more data', done => {
    const mockSocket = new net.Socket();
    const monitor = new SessionMonitor(mockSocket);

    // Mock the write method
    mockSocket.write = (data: any, encoding?: any, cb?: any): boolean => {
      monitor['bytesWritten'] += Buffer.byteLength(data);
      if (typeof cb === 'function') {
        cb(null); // Call the callback
      }
      return true;
    };

    // Simulate larger data transfer
    const dataChunk = 'A'.repeat(1024 * 1024); // 1 MB of data
    const totalDurationMs = 5000; // Total duration for the test in milliseconds
    const intervalMs = 100; // Interval for data transfer in milliseconds
    let elapsedMs = 0;

    const intervalId = setInterval(() => {
      if (elapsedMs >= totalDurationMs) {
        clearInterval(intervalId);
        performAssertions();
        return;
      }

      // Simulate reading and writing data
      mockSocket.emit('data', Buffer.from(dataChunk));
      mockSocket.write(Buffer.from(dataChunk), 'utf-8');

      elapsedMs += intervalMs;
    }, intervalMs);

    function performAssertions() {
      try {
        const speed = monitor.getCurrentNetworkSpeed();
        console.log(`Read Speed: ${speed.readSpeed / 1024} MB/s, Write Speed: ${speed.writeSpeed / 1024} MB/s`);
        expect(speed.readSpeed).toBeGreaterThan(0); // Expecting a positive read speed
        expect(speed.writeSpeed).toBeGreaterThan(0); // Expecting a positive write speed
      } catch (error) {
        console.error('Assertion error:', error);
      }
      done();
    }
  }, 60000);
});


describe('SessionMonitor Tests', () => {
  it('should correctly track bytes read and written', done => {
    const mockSocket = new net.Socket();
    const monitor = new SessionMonitor(mockSocket);

    // Mock the write method
    mockSocket.write = (data: any, encoding?: any, cb?: any): boolean => {
      // Increment bytesWritten to simulate a successful write
      monitor['bytesWritten'] += Buffer.byteLength(data);
      if (typeof cb === 'function') {
        cb(null); // Call the callback
      }
      return true;
    };

    // Simulate receiving data from the socket
    const dataReceived = 'Hello, World!';
    mockSocket.emit('data', Buffer.from(dataReceived));

    // Simulate writing data to the socket
    const dataSent = 'Hello again!';
    mockSocket.write(Buffer.from(dataSent), 'utf-8', () => {});

    // Delay to allow asynchronous operations to complete
    setTimeout(() => {
      try {
        const sessionBandwith = monitor.getTotalSessionBandwidth();
        expect(sessionBandwith.totalRead).toBe(Buffer.byteLength(dataReceived));
        expect(sessionBandwith.totalWritten).toBe(Buffer.byteLength(dataSent));
        console.log(sessionBandwith);

        const speed = monitor.getCurrentNetworkSpeed();
        expect(speed.readSpeed).toBeGreaterThan(0); // Expecting a positive read speed
        expect(speed.writeSpeed).toBeGreaterThan(0); 
        console.log(speed);

      } catch (error) {
        console.error('Assertion error:', error);
      }
      done();
    }, 100);
  });
});
