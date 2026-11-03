import { apiClient } from './client.js';
import { io } from 'socket.io-client';
import { WS_BASE_URL } from '../utils/constants.js';

class SocketClient {
  constructor() {
    this.socket = null;
    this.status = 'disconnected'; // 'connecting', 'connected', 'disconnected'
    this.lastError = null;
    this.statusListeners = new Set();
    this.joinedRooms = new Set();
  }

  connect() {
    if (this.socket) return this.socket;

    this.setStatus('connecting');
    this.lastError = null;

    this.socket = io(WS_BASE_URL, {
      auth: callback => callback({ token: apiClient.token }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.lastError = null;
      this.setStatus('connected');
      // Re-join rooms on reconnect
      for (const room of this.joinedRooms) {
        this.socket.emit('join', room);
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.lastError = reason === 'io server disconnect'
        ? 'Session ended or expired. Sign in again to restore live updates.'
        : `Live connection interrupted (${reason}). Reconnecting…`;
      this.setStatus('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      this.lastError = error?.message === 'Authentication required'
        ? 'Socket authentication failed. Sign in again with your driver or rider account.'
        : `Socket connection failed: ${error?.message || 'Check the trusted HTTPS connection.'}`;
      this.setStatus('disconnected');
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.setStatus('disconnected');
    }
  }

  setStatus(status) {
    this.status = status;
    this.statusListeners.forEach((fn) => fn(status, this.lastError));
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback(this.status, this.lastError);
    return () => this.statusListeners.delete(callback);
  }

  joinRoom(room) {
    if (!room) return;
    this.joinedRooms.add(room);
    if (this.socket && this.socket.connected) {
      this.socket.emit('join', room);
    }
  }

  // Client -> Server Emitters
  emitDriverLocation({ driverId, latitude, longitude, heading = 0, speed = 0, accuracy = null, timestamp = null }) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('driver:location', {
      driverId,
      latitude,
      longitude,
      heading,
      speed,
      accuracy: typeof accuracy === 'number' ? accuracy : undefined,
      timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
    });
  }

  emitDriverOnline(driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('driver:online', { driverId });
  }

  emitDriverOffline(driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('driver:offline', { driverId });
  }

  emitRideAccepted(rideId, driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('ride:accepted', { rideId, driverId });
  }

  emitRideArrived(rideId, driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('ride:arrived', { rideId, driverId });
  }

  emitRideStarted(rideId, driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('ride:started', { rideId, driverId });
  }

  emitRideCompleted(rideId, driverId) {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('ride:completed', { rideId, driverId });
  }

  emitRideCancelled(rideId, reason = '') {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('ride:cancelled', { rideId, reason });
  }

  // Server -> Client Listeners
  onError(callback) {
    if (!this.socket) this.connect();
    this.socket.on('error', callback);
    return () => this.socket?.off('error', callback);
  }

  onRideStatusChanged(callback) {
    if (!this.socket) this.connect();
    this.socket.on('ride:status_changed', callback);
    return () => this.socket?.off('ride:status_changed', callback);
  }

  onDriverStatusChanged(callback) {
    if (!this.socket) this.connect();
    this.socket.on('driver:status_changed', callback);
    return () => this.socket?.off('driver:status_changed', callback);
  }

  onLocationUpdate(callback) {
    if (!this.socket) this.connect();
    this.socket.on('location:update', callback);
    return () => this.socket?.off('location:update', callback);
  }

  onRideCreated(callback) {
    if (!this.socket) this.connect();
    this.socket.on('ride:created', callback);
    return () => this.socket?.off('ride:created', callback);
  }

  onRideOffer(callback) {
    if (!this.socket) this.connect();
    this.socket.on('ride:offer', callback);
    return () => this.socket?.off('ride:offer', callback);
  }
}

export const socketClient = new SocketClient();
