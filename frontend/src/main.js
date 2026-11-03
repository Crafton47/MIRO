import './style.css';
import { store } from './state/store.js';
import { apiClient } from './api/client.js';
import { socketClient } from './api/socket.js';
import { mapManager } from './map/mapManager.js';
import { geocodingService } from './services/geocodingService.js';
import { routingService } from './services/routingService.js';
import { requireSession } from './components/session.js';
import { gpsService } from './services/gpsService.js';
import { RiderView } from './views/riderView.js';
import { DriverView } from './views/driverView.js';
import { toast } from './utils/toast.js';
import { DEMO_USERS, API_BASE_URL } from './utils/constants.js';
import { networkModal } from './components/networkModal.js';

class App {
  constructor() {
    this.riderView = null;
    this.driverView = null;
  }

  async init() {
    const mode = await requireSession();
    // Set initial mode on body
    document.body.classList.remove('driver-mode');
    document.body.classList.add('rider-mode');

    // 1. Initialize Leaflet Map
    mapManager.init('map-container');
    const { pickup, destination } = store.getState();

    // Draggable Pickup Marker
    mapManager.setPickupMarker(pickup.lat, pickup.lng, async (lat, lng) => {
      let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      try {
        const rev = await geocodingService.reverseGeocode(lat, lng);
        if (rev && rev.address) address = rev.address;
      } catch { }
      store.setPickup(lat, lng, address);
      this.riderView?.updateRouteAndFare();
      this.riderView?.fetchNearbyDrivers();
    });

    // Draggable Destination Marker
    mapManager.setDestinationMarker(destination.lat, destination.lng, async (lat, lng) => {
      let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      try {
        const rev = await geocodingService.reverseGeocode(lat, lng);
        if (rev && rev.address) address = rev.address;
      } catch { }
      store.setDestination(lat, lng, address);
      this.riderView?.updateRouteAndFare();
    });

    // Initial Views
    this.riderView = new RiderView('view-rider');
    this.driverView = new DriverView('view-driver');

    this.riderView.render();
    this.driverView.render();

    // Map click handling with real reverse geocoding
    mapManager.onMapClick(async (latlng, target) => {
      const clickMode = mapManager.getClickTarget();
      const selectionId = this.mapSelectionId = (this.mapSelectionId || 0) + 1;
      const exactLat = parseFloat(latlng.lat.toFixed(6));
      const exactLng = parseFloat(latlng.lng.toFixed(6));

      if (clickMode === 'pickup') {
        // Immediately place green pickup marker at exact clicked position
        mapManager.setPickupMarker(exactLat, exactLng);
        store.setPickup(exactLat, exactLng, 'Resolving address...');
        this.riderView.render();

        try {
          const rev = await geocodingService.reverseGeocode(exactLat, exactLng);
          if (selectionId !== this.mapSelectionId) return;
          const address = rev?.address || `${exactLat.toFixed(5)}, ${exactLng.toFixed(5)}`;
          store.setPickup(exactLat, exactLng, address);
          toast.info(`Pickup set: ${address}`);
        } catch {
          if (selectionId !== this.mapSelectionId) return;
          store.setPickup(exactLat, exactLng, `${exactLat.toFixed(5)}, ${exactLng.toFixed(5)}`);
        }

        // Alternate to destination for smooth user workflow
        mapManager.setClickTarget('destination');
      } else {
        // Immediately place red destination marker at exact clicked position
        mapManager.setDestinationMarker(exactLat, exactLng);
        store.setDestination(exactLat, exactLng, 'Resolving address...');
        this.riderView.render();

        try {
          const rev = await geocodingService.reverseGeocode(exactLat, exactLng);
          if (selectionId !== this.mapSelectionId) return;
          const address = rev?.address || `${exactLat.toFixed(5)}, ${exactLng.toFixed(5)}`;
          store.setDestination(exactLat, exactLng, address);
          toast.info(`Destination set: ${address}`);
        } catch {
          if (selectionId !== this.mapSelectionId) return;
          store.setDestination(exactLat, exactLng, `${exactLat.toFixed(5)}, ${exactLng.toFixed(5)}`);
        }

        mapManager.setClickTarget('pickup');
      }

      // Re-calculate real road route and update views
      await this.riderView.updateRouteAndFare();
      if (clickMode === 'pickup') {
        this.riderView.fetchNearbyDrivers();
      }
      this.riderView.render();
    });

    // 2. Navigation Controls
    this.setupNavigation();
    document.getElementById(`tab-${mode}`)?.click();
    document.getElementById(mode === 'driver' ? 'tab-rider' : 'tab-driver').disabled = true;
    const syncRide = async () => {
      const revision = store.rideRevision;
      try { const result = await apiClient.request('/api/v1/rides/active');
        if (!store.setActiveRide(result.data, revision)) return;
        if (result.location) store.setDriverLocation({ lat: result.location.latitude, lng: result.location.longitude, driverId: result.location.driverId, heading: result.location.heading, speed: result.location.speed, accuracy: result.location.accuracy, updatedAt: result.location.updatedAt });
      }
      catch (error) { console.warn('Session sync failed:', error.message); }
    };
    this.syncRide = syncRide;
    await syncRide();
    window.addEventListener('pagehide', () => { gpsService.stop(); socketClient.disconnect(); });
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        socketClient.connect(); // Preserve registered event handlers on BFCache restore.
        this.syncRide?.();
      }
    });
    setInterval(() => {
      if (store.getState().currentMode === 'rider') this.riderView.fetchNearbyDrivers();
    }, 10000);

    // 3. Header Simulator Actions
    this.setupHeaderActions();

    // 4. Real-Time Socket Connection
    this.initSocketEvents();

    // 5. Initial Diagnostics & Driver Discovery
    this.checkHealth();

    // Subscribe to driverLocation updates so local GPS immediately moves D1 marker
    store.subscribe('driverLocation', () => {
      const { driverLocation } = store.getState();
      if ((!driverLocation.driverId || driverLocation.driverId === DEMO_USERS.driver1.id) && driverLocation && typeof driverLocation.lat === 'number' && typeof driverLocation.lng === 'number') {
        mapManager.updateSingleDriverPosition(
          DEMO_USERS.driver1.id,
          driverLocation.lat,
          driverLocation.lng,
          driverLocation.heading || 0
        );
        mapManager.centerOnD1Once(driverLocation.lat, driverLocation.lng);
      }
    });

    // Initial real road route calculation & nearby driver search
    await this.riderView.updateRouteAndFare();
    if (mode === 'rider') this.riderView.fetchNearbyDrivers();
  }

  setupNavigation() {
    const tabRider = document.getElementById('tab-rider');
    const tabDriver = document.getElementById('tab-driver');
    const viewRider = document.getElementById('view-rider');
    const viewDriver = document.getElementById('view-driver');

    tabRider?.addEventListener('click', () => {
      if (store.getState().currentUser.role !== 'RIDER') return;
      tabRider.classList.add('active');
      tabDriver.classList.remove('active');
      viewRider.style.display = 'block';
      viewDriver.style.display = 'none';

      document.body.classList.remove('driver-mode');
      document.body.classList.add('rider-mode');

      store.setMode('rider');
      this.riderView.render();
      setTimeout(() => mapManager.map?.invalidateSize(), 50);
    });

    tabDriver?.addEventListener('click', () => {
      if (store.getState().currentUser.role !== 'DRIVER') return;
      tabDriver.classList.add('active');
      tabRider.classList.remove('active');
      viewRider.style.display = 'none';
      viewDriver.style.display = 'block';

      document.body.classList.remove('rider-mode');
      document.body.classList.add('driver-mode');

      store.setMode('driver');
      this.driverView.render();
      setTimeout(() => mapManager.map?.invalidateSize(), 50);
    });
  }

  setupHeaderActions() {
    const btnSim = document.getElementById('btn-toggle-sim');
    const simText = document.getElementById('sim-text');

    btnSim?.addEventListener('click', async () => {
      btnSim.disabled = true;
      const isRunning = store.getState().isSimulatorRunning;

      try {
        if (!isRunning) {
          const res = await apiClient.startSimulator({
            centerLat: store.getState().pickup.lat,
            centerLng: store.getState().pickup.lng,
          });
          if (res.success) {
            store.setState({ isSimulatorRunning: true });
            btnSim.classList.add('running');
            simText.innerText = 'Pause Simulator';
            toast.success('Fleet simulator active (7 background vehicles circulating).');
            this.riderView?.fetchNearbyDrivers();
          }
        } else {
          const res = await apiClient.stopSimulator();
          if (res.success) {
            store.setState({ isSimulatorRunning: false });
            btnSim.classList.remove('running');
            simText.innerText = 'Start Fleet Simulator';
            toast.info('Fleet simulator paused.');
          }
        }
      } catch (err) {
        toast.error(`Simulator error: ${err.message}`);
      } finally {
        btnSim.disabled = false;
      }
    });

    // Dynamic Backend Diagnostics URL
    const diagLink = document.getElementById('link-diagnostics');
    if (diagLink) {
      diagLink.href = `${API_BASE_URL}/dashboard`;
    }

    // Mobile Phone Connect Modal Trigger
    document.getElementById('btn-phone-connect')?.addEventListener('click', () => {
      networkModal.open();
    });
  }

  initSocketEvents() {
    socketClient.connect();
    socketClient.socket.on('ride:unassigned', ({ rideId, reason }) => {
      if (!store.releaseDriverRide(rideId)) return;
      toast.info(reason === 'timeout' ? 'Offer expired. We are checking other drivers.' : 'Offer declined. We are checking other drivers.');
    });

    // Connection Status Indicator
    socketClient.onStatusChange((status, error) => {
      if (status === 'connected') this.syncRide?.();
      const dot = document.getElementById('health-dot');
      const label = document.getElementById('health-label');
      if (dot && label) {
        label.title = error || 'Authenticated live connection';
        if (status === 'connected') {
          dot.className = 'status-beacon online';
          label.innerText = 'Live WS';
        } else {
          dot.className = 'status-beacon offline';
          label.innerText = status === 'connecting' ? 'Connecting...' : 'Offline';
        }
      }
    });

    const locationTimes = new Map();
    // 1. High-Frequency Real-Time Location Updates
    socketClient.onLocationUpdate((data) => {
      if (!data) return;
      const driverId = data.driverId || data.entityId;
      if (!driverId) return;

      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const updatedAt = Number(data.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt > Date.now() + 10000 || Date.now() - updatedAt > 60000) return;
      if (updatedAt <= (locationTimes.get(driverId) || 0)) return;
      locationTimes.set(driverId, updatedAt);
      const heading = data.heading || 0;

      // Keep active trip / driver view telemetry state updated if applicable
      store.setDriverLocation({ lat, lng, driverId, heading, speed: data.speed || 0, accuracy: data.accuracy, updatedAt: data.updatedAt });

      const isD1 = driverId === DEMO_USERS.driver1.id;
      if (isD1) {
        mapManager.updateSingleDriverPosition(driverId, lat, lng, heading);
        mapManager.centerOnD1Once(lat, lng);
      } else {
        mapManager.updateSingleSimulatedDriver(driverId, lat, lng, heading);
      }

      // Calculate distance strictly relative to PICKUP coordinates
      const state = store.getState();
      const pickup = state.pickup;
      const distMeters = routingService.haversineDistance(pickup, { lat, lng });
      const distKm = parseFloat((distMeters / 1000).toFixed(2));
      const etaMinutes = Math.max(1, Math.round(distKm * 2.5));

      const drivers = [...state.nearbyDrivers];
      const existingIdx = drivers.findIndex((d) => d.driverId === driverId);

      const driverName = isD1
        ? 'Debashis Mukherjee (D1)'
        : existingIdx >= 0 ? drivers[existingIdx].driverName : `Simulated Fleet (${driverId.slice(-4)})`;

      const updatedDriver = {
        driverId,
        driverName,
        rating: 4.9,
        latitude: lat,
        longitude: lng,
        speed: data.speed,
        heading,
        h3Index: data.h3Index,
        distanceKm: distKm,
        etaMinutes: etaMinutes,
        isReal: isD1,
      };

      if (existingIdx >= 0) {
        drivers[existingIdx] = { ...drivers[existingIdx], ...updatedDriver };
      } else {
        drivers.push(updatedDriver);
      }

      // Sort candidate drivers strictly ascending by distance to pickup
      drivers.sort((a, b) => a.distanceKm - b.distanceKm);

      store.setNearbyDrivers(drivers);
      const activeRide = state.activeRide;
      mapManager.updateDriverMarkers(drivers, activeRide?.driverId);
    });

    // 2. Driver Availability Changed
    socketClient.onDriverStatusChanged(() => {
      this.riderView?.fetchNearbyDrivers();
    });

    // 3. Ride Lifecycle Status Changed
    socketClient.onRideStatusChanged((data) => {
      if (!data || !data.rideId) return;
      const user = store.getState().currentUser;
      if (data.ride && data.ride.riderId !== user.id && data.ride.driverId !== user.id) return;

      const currentActive = store.getState().activeRide;
      const updatedRide = data.ride || { ...(currentActive || {}), id: data.rideId, status: data.status, driver: data.driver };

      if (!store.setActiveRide(updatedRide)) return;
      if (user.role === 'DRIVER' && updatedRide.status === 'COMPLETED') store.addCompletedTrip(updatedRide);
      if (data.status === 'CANCELLED') toast.info('Ride cancelled. You can request another ride.');
      toast.info(`Ride status: ${data.status.replace('_', ' ')}`);

      if (store.getState().currentMode === 'rider') {
        this.riderView.render();
      } else {
        this.driverView.render();
      }
    });

    // 4. WebSocket Error Listener
    socketClient.onError((err) => {
      console.warn('Socket message:', err);
      toast.error(`${err.event || 'Socket action'}: ${err.message || 'Update rejected'}`);
    });
  }

  async checkHealth() {
    try {
      const res = await apiClient.getSystemStatus();
      if (res.success) {
        const s = res.data;
        const btnSim = document.getElementById('btn-toggle-sim');
        const simText = document.getElementById('sim-text');

        if (s.simulator) {
          store.setState({ isSimulatorRunning: s.simulator.isRunning });
          if (btnSim && simText) {
            if (s.simulator.isRunning) {
              btnSim.classList.add('running');
              simText.innerText = 'Pause Simulator';
            } else {
              btnSim.classList.remove('running');
              simText.innerText = 'Start Fleet Simulator';
            }
          }
        }
      }
    } catch {
      document.getElementById('btn-toggle-sim')?.setAttribute('hidden', '');
      document.getElementById('link-diagnostics')?.setAttribute('hidden', '');
    }
  }
}

// Start application
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(error => toast.error(error.message));
});
