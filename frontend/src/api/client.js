import { API_BASE_URL } from '../utils/constants.js';

class ApiClient {
  constructor(baseUrl = API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem('miro_jwt_token') || sessionStorage.getItem('miro_jwt_token') || null;
  }

  setToken(token, remember = false) {
    this.token = token;
    if (token) {
      if (remember) {
        localStorage.setItem('miro_jwt_token', token);
        sessionStorage.removeItem('miro_jwt_token');
      } else {
        sessionStorage.setItem('miro_jwt_token', token);
        localStorage.removeItem('miro_jwt_token');
      }
    } else {
      sessionStorage.removeItem('miro_jwt_token');
      localStorage.removeItem('miro_jwt_token');
      localStorage.removeItem('uber_jwt_token');
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        ...options,
        headers,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.error?.message || data?.message || `Request failed with status ${response.status}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.code = data?.error?.code || 'API_ERROR';
        err.details = data;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        const networkErr = new Error('Cannot reach backend server. Please verify it is running on port 3000.');
        networkErr.status = 0;
        networkErr.code = 'NETWORK_OFFLINE';
        throw networkErr;
      }
      throw err;
    }
  }

  // Health and System
  async getHealth() {
    return this.request('/health');
  }

  async getSystemStatus() {
    return this.request('/api/v1/system/status');
  }

  async getNetworkInfo() {
    return this.request('/api/v1/system/network-info');
  }

  // Auth
  async login(email, password, rememberMe = false) {
    const res = await this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe }),
    });
    if (res.data?.token) {
      this.setToken(res.data.token, rememberMe);
    }
    return res;
  }

  async register(data, rememberMe = false) {
    const res = await this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.data?.token) {
      this.setToken(res.data.token, rememberMe);
    }
    return res;
  }

  async logout() {
    try {
      await this.request('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network / token errors during logout
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this.request('/api/v1/auth/me');
  }

  async forgotPassword(email) {
    return this.request('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token, password) {
    return this.request('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async verifyEmail(token) {
    return this.request('/api/v1/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async resendVerification(email) {
    return this.request('/api/v1/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // Drivers
  async getNearbyDrivers(latitude, longitude, radiusKm = 5) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      radiusKm: String(radiusKm),
    });
    return this.request(`/api/v1/drivers/nearby?${params.toString()}`);
  }

  async getDriver(driverId) {
    return this.request(`/api/v1/drivers/${driverId}`);
  }

  async updateDriverStatus(driverId, status) {
    return this.request(`/api/v1/drivers/${driverId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async updateDriverLocation(driverId, { latitude, longitude, heading = 0, speed = 0, accuracy, timestamp }) {
    return this.request(`/api/v1/drivers/${driverId}/location`, {
      method: 'PATCH',
      body: JSON.stringify({ latitude, longitude, heading, speed, accuracy, timestamp }),
    });
  }

  // Rides
  async estimateFare(pickupLat, pickupLng, destLat, destLng) {
    return this.request('/api/v1/rides/estimate', {
      method: 'POST',
      body: JSON.stringify({ pickupLat, pickupLng, destLat, destLng }),
    });
  }

  async createRide(rideData) {
    return this.request('/api/v1/rides', {
      method: 'POST',
      body: JSON.stringify(rideData),
    });
  }

  async getRide(rideId) {
    return this.request(`/api/v1/rides/${rideId}`);
  }

  async acceptRide(rideId, driverId) {
    return this.request(`/api/v1/rides/${rideId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ driverId }),
    });
  }

  async declineRide(rideId) {
    return this.request(`/api/v1/rides/${rideId}/decline`, { method: 'POST' });
  }

  async arriveRide(rideId) {
    return this.request(`/api/v1/rides/${rideId}/arrive`, {
      method: 'POST',
    });
  }

  async startRide(rideId) {
    return this.request(`/api/v1/rides/${rideId}/start`, {
      method: 'POST',
    });
  }

  async completeRide(rideId) {
    return this.request(`/api/v1/rides/${rideId}/complete`, {
      method: 'POST',
    });
  }

  async cancelRide(rideId, reason = 'User requested cancellation') {
    return this.request(`/api/v1/rides/${rideId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Simulator
  async startSimulator({ centerLat = 22.5646, centerLng = 88.3510, intervalMs = 3000 } = {}) {
    return this.request('/api/v1/simulator/start', {
      method: 'POST',
      body: JSON.stringify({ centerLat, centerLng, intervalMs }),
    });
  }

  async stopSimulator() {
    return this.request('/api/v1/simulator/stop', {
      method: 'POST',
    });
  }

  async getSimulatorStatus() {
    return this.request('/api/v1/simulator/status');
  }
}

export const apiClient = new ApiClient();
