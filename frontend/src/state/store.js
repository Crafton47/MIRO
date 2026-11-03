import { DEFAULT_COORDS, DEMO_USERS, DRIVER_STATUS, VEHICLE_TIERS } from '../utils/constants.js';

export class AppStore {
  constructor() {
    this.state = {
      currentMode: 'rider', // 'rider' | 'driver'
      currentUser: DEMO_USERS.rider,
      pickup: { ...DEFAULT_COORDS.pickup },
      destination: { ...DEFAULT_COORDS.destination },
      selectedTierId: 'miro_go',
      fareEstimate: null,
      nearbyDrivers: [],
      activeRide: null,
      driverAvailability: DRIVER_STATUS.OFFLINE,
      driverLocation: { lat: null, lng: null, heading: 0, speed: 0 },
      incomingRequests: [],
      isSimulatorRunning: false,
      systemHealth: { backend: 'checking', redis: 'unknown', postgres: 'unknown', socket: 'connecting' },
      completedTrips: [],
      driverEarnings: 0, // Initial seed demo earnings in INR (₹)
    };

    this.listeners = new Map();
    this.rideRevision = 0;
    this.rideSnapshots = new Map();
    this.releasedRideIds = new Set();
  }

  getState() {
    return this.state;
  }

  setState(partialState) {
    const prevState = { ...this.state };
    this.state = { ...this.state, ...partialState };

    // Notify listeners of changed keys
    for (const key of Object.keys(partialState)) {
      if (this.listeners.has(key)) {
        this.listeners.get(key).forEach((callback) => {
          callback(this.state[key], prevState[key]);
        });
      }
    }

    // Global listener
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach((callback) => callback(this.state, prevState));
    }
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
    return () => this.listeners.get(key)?.delete(callback);
  }

  setMode(mode) {
    const allowed = this.state.currentUser.role === 'DRIVER' ? 'driver' : 'rider';
    if (mode === allowed) this.setState({ currentMode: mode });
  }

  setTier(tierId) {
    this.setState({ selectedTierId: tierId });
  }

  getSelectedTier() {
    return VEHICLE_TIERS.find((t) => t.id === this.state.selectedTierId) || VEHICLE_TIERS[0];
  }

  setPickup(lat, lng, address) {
    const numLat = parseFloat(Number(lat).toFixed(6));
    const numLng = parseFloat(Number(lng).toFixed(6));
    this.setState({
      pickup: {
        lat: numLat,
        lng: numLng,
        address: address || `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`,
      },
    });
  }

  setDestination(lat, lng, address) {
    const numLat = parseFloat(Number(lat).toFixed(6));
    const numLng = parseFloat(Number(lng).toFixed(6));
    this.setState({
      destination: {
        lat: numLat,
        lng: numLng,
        address: address || `${numLat.toFixed(5)}, ${numLng.toFixed(5)}`,
      },
    });
  }

  setActiveRide(ride, expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== this.rideRevision) return false;
    if (ride) {
      if (this.state.currentMode === 'driver' && this.releasedRideIds.has(ride.id)) return false;
      const previous = this.rideSnapshots.get(ride.id);
      const order = ['REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
      if (previous) {
        if (['COMPLETED', 'CANCELLED'].includes(previous.status)) return false;
        const before = Date.parse(previous.updatedAt), after = Date.parse(ride.updatedAt);
        if (Number.isFinite(before) && (!Number.isFinite(after) || after < before)) return false;
        if (ride.status !== 'CANCELLED' && order.indexOf(ride.status) < order.indexOf(previous.status)) return false;
      }
      this.rideSnapshots.set(ride.id, { ...ride });
    }
    this.rideRevision++;
    if (this.state.currentMode === 'rider' && this.state.activeRide?.driverId !== ride?.driverId) {
      this.setState({ driverLocation: { lat: null, lng: null, heading: 0, speed: 0, driverId: ride?.driverId } });
    }
    this.setState({ activeRide: ride });
    return true;
  }

  releaseDriverRide(rideId) {
    if (this.state.currentMode !== 'driver' || typeof rideId !== 'string' || !rideId) return false;
    // Dispatch excludes a driver once released from this ride. Remember releases
    // even when they arrive before the original offer or after a newer offer.
    this.releasedRideIds.add(rideId);
    this.rideRevision++;
    if (this.state.activeRide?.id !== rideId) return false;
    this.setActiveRide(null);
    this.setDriverAvailability(DRIVER_STATUS.ONLINE);
    return true;
  }

  addCompletedTrip(trip) {
    if (!trip?.id || trip.status !== 'COMPLETED' || this.state.completedTrips.some(existing => existing.id === trip.id)) return;
    const trips = [trip, ...this.state.completedTrips];
    const newEarnings = this.state.driverEarnings + (trip.finalFare ?? trip.estimatedFare ?? 0);
    this.setState({ completedTrips: trips, driverEarnings: newEarnings });
  }

  setNearbyDrivers(drivers) {
    this.setState({ nearbyDrivers: drivers });
  }

  setDriverAvailability(status) {
    this.setState({ driverAvailability: status });
  }

  setDriverLocation(location) {
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return false;
    const expectedDriver = this.state.currentMode === 'driver' ? this.state.currentUser.id : this.state.activeRide?.driverId;
    if (!expectedDriver || location.driverId !== expectedDriver) return false;
    const previous = this.state.driverLocation;
    if (!Number.isFinite(location.updatedAt) || location.updatedAt > Date.now() + 10000) return false;
    if (previous.driverId === location.driverId && Number.isFinite(previous.updatedAt) && location.updatedAt <= previous.updatedAt) return false;
    this.setState({ driverLocation: { ...location } });
    return true;
  }
}

export const store = new AppStore();
