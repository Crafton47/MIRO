/**
 * GPS Service — Real Driver 1 Live GPS
 *
 * Manages the browser Geolocation watchPosition lifecycle for Driver 1.
 * Writes once over authenticated HTTP; the backend broadcasts over Socket.IO.
 * Provides rich status to the UI: permission, connection, accuracy, last update.
 *
 * Rules:
 *  - Only Driver 1 (REAL_DRIVER_ID) may use this service.
 *  - Never substitutes simulated coordinates for real GPS.
 *  - Stops cleanly on: disconnect, go-offline, explicit disable, or error.
 *  - Does NOT call simulationEngine.stop(); that is the caller's responsibility.
 */

import { apiClient } from '../api/client.js';
import { store } from '../state/store.js';
import { DEMO_USERS } from '../utils/constants.js';

export const GPS_STATUS = {
  IDLE: 'IDLE',               // Never started
  REQUESTING: 'REQUESTING',   // Awaiting browser permission
  ACTIVE: 'ACTIVE',           // Receiving real positions
  ERROR: 'ERROR',             // Permission denied / unavailable / timeout
  STOPPED: 'STOPPED',         // Cleanly stopped by caller
  INSECURE: 'INSECURE',       // Not on HTTPS or localhost
};

class GpsService {
  constructor() {
    this.status = GPS_STATUS.IDLE;
    this.watchId = null;
    this.lastPosition = null;
    this.lastError = null;
    this.lastUpdateTime = null;
    this.accuracy = null;
    this.statusListeners = new Set();
    this._emitThrottle = 0;
    this.generation = 0;
    this.lastSharedTime = null;
    this.sharingError = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start watching real GPS. Only works for Driver 1.
   * Immediately rejects in insecure contexts (non-HTTPS, non-localhost).
   */
  start() {
    if (this.watchId !== null) {
      if (this.status !== GPS_STATUS.ERROR) return;
      this.stop();
    }

    if (store.getState().currentMode !== 'driver' || store.getState().currentUser.id !== DEMO_USERS.driver1.id) {
      this._setStatus(GPS_STATUS.ERROR, null, 'Live GPS is reserved for the signed-in D1 driver.'); return;
    }
    if (store.getState().driverAvailability === 'OFFLINE') {
      this._setStatus(GPS_STATUS.ERROR, null, 'Go online before enabling live GPS.'); return;
    }
    if (!window.isSecureContext) {
      this._setStatus(GPS_STATUS.INSECURE, null, 'Use the trusted HTTPS address to enable phone GPS.'); return;
    }
    // Check if Geolocation API is available
    if (!navigator.geolocation) {
      this._setStatus(GPS_STATUS.ERROR, null, 'Geolocation is unavailable in this browser. Use a browser with location support.');
      return;
    }

    this._setStatus(GPS_STATUS.REQUESTING);

    const generation = ++this.generation;
    this._emitThrottle = 0;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => { if (generation === this.generation) this._onPosition(pos); },
      (err) => { if (generation === this.generation) this._onError(err); },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );
  }

  /**
   * Stop watching GPS and clean up. Safe to call multiple times.
   */
  stop() {
    this.generation++;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this._setStatus(GPS_STATUS.STOPPED);
  }

  /**
   * Returns whether GPS is currently active and receiving positions.
   */
  isActive() {
    return this.status === GPS_STATUS.ACTIVE;
  }

  /**
   * Get current GPS status snapshot for UI rendering.
   */
  getStatusSnapshot() {
    return {
      status: this.status,
      lastPosition: this.lastPosition,
      lastError: this.lastError,
      lastUpdateTime: this.lastUpdateTime,
      accuracy: this.accuracy,
      lastSharedTime: this.lastSharedTime,
      sharingError: this.sharingError,
      watching: this.watchId !== null,
    };
  }

  /**
   * Subscribe to status changes. Returns an unsubscribe function.
   * Callback receives the current status snapshot.
   */
  onStatusChange(callback) {
    this.statusListeners.add(callback);
    // Immediately deliver current state
    callback(this.getStatusSnapshot());
    return () => this.statusListeners.delete(callback);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _onPosition(pos) {
    if (this.watchId === null || store.getState().driverAvailability === 'OFFLINE') return;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    // Strict numerical coordinate validation
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.warn('[GpsService] Invalid GPS position rejected');
      return;
    }

    const heading = pos.coords.heading != null && !isNaN(pos.coords.heading)
      ? pos.coords.heading
      : 0;
    const speed = pos.coords.speed != null && !isNaN(pos.coords.speed)
      ? pos.coords.speed * 3.6  // m/s → km/h
      : 0;
    const accuracy = pos.coords.accuracy;
    if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100 || !Number.isFinite(pos.timestamp) || pos.timestamp > Date.now() + 10000 || Date.now() - pos.timestamp > 15000) {
      this._setStatus(GPS_STATUS.ERROR, null, 'GPS accuracy is too low or the reading is stale. Move to an open area.'); return;
    }

    if (this.lastUpdateTime != null && pos.timestamp <= this.lastUpdateTime) return;
    if (store.setDriverLocation({ lat, lng, heading, speed, accuracy, updatedAt: pos.timestamp, driverId: store.getState().currentUser.id }) === false) return;
    this.lastPosition = { lat, lng, heading, speed };
    this.lastUpdateTime = pos.timestamp;
    this.accuracy = accuracy;
    this.lastError = null;

    this._setStatus(GPS_STATUS.ACTIVE);

    // Update frontend store so telemetry panel reflects real position


    // Throttled authenticated HTTP write (max every 1.5s)
    const now = Date.now();
    if (now - this._emitThrottle > 1500) {
      this._emitThrottle = now;
      this._broadcastLocation(lat, lng, heading, speed);
    }
  }

  _onError(err) {
    let message;
    switch (err.code) {
      case 1:
        message = 'Location permission denied. Allow location for this HTTPS site in browser settings and enable device location access. Then retry.';
        break;
      case 2:
        message = 'GPS position unavailable. Check device location service and try again.';
        break;
      case 3:
        message = 'GPS timed out. Ensure device GPS is enabled and try again.';
        break;
      default:
        message = `GPS error (${err.message})`;
    }

    console.warn('[GpsService] Error:', message);
    this.lastError = message;

    // On PERMISSION_DENIED, stop watching — it won't recover
    if (err.code === 1) {
      this.generation++;
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }

    this._setStatus(GPS_STATUS.ERROR, null, message);
  }

  async _broadcastLocation(lat, lng, heading, speed) {
    const generation = this.generation;
    const driverId = store.getState().currentUser.id;
    const accuracy = typeof this.accuracy === 'number' ? Math.round(this.accuracy) : undefined;
    const timestamp = this.lastUpdateTime || Date.now();

    // One authoritative write per reading. HTTP confirms persistence and the server
    // broadcasts to authorized participants; avoid duplicate socket/HTTP writes.
    try {
      const result = await apiClient.updateDriverLocation(driverId, {
        latitude: lat,
        longitude: lng,
        heading: Math.round(heading),
        speed: Math.round(speed),
        accuracy,
        timestamp,
      });
      if (generation !== this.generation) return;
      this.lastSharedTime = Math.max(this.lastSharedTime || 0, result?.data?.updatedAt || timestamp);
      this.sharingError = null;
      this._setStatus(this.status);
    } catch (e) {
      if (generation !== this.generation) return;
      const hint = e.status === 401 ? 'Sign in again; your session expired.'
        : e.status === 403 ? 'This account is not authorized for D1.'
        : e.status === 409 ? 'Go online before sharing location.'
        : 'Check the HTTPS connection and backend availability.';
      this.sharingError = `Location update failed (${e.status || e.code || 'network'}). ${hint}`;
      console.warn('[GpsService]', this.sharingError);
      this._setStatus(this.status);
    }
  }

  _setStatus(status, position = null, errorMsg = null) {
    this.status = status;
    if (errorMsg) this.lastError = errorMsg;
    const snapshot = this.getStatusSnapshot();
    this.statusListeners.forEach((fn) => fn(snapshot));
  }
}

export const gpsService = new GpsService();
