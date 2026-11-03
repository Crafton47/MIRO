import { escapeHtml } from '../utils/escape.js';
import { store } from '../state/store.js';
import { apiClient } from '../api/client.js';
import { mapManager } from '../map/mapManager.js';
import { gpsService, GPS_STATUS } from '../services/gpsService.js';
import { routingService } from '../services/routingService.js';
import { toast } from '../utils/toast.js';
import { DRIVER_STATUS, RIDE_STATUS, DEMO_USERS, CURRENCY_SYMBOL } from '../utils/constants.js';
import { Icons } from '../utils/icons.js';

export class DriverView {
  constructor(containerId = 'view-driver') {
    this.container = document.getElementById(containerId);
    this.isActionLoading = false;
    this.gpsSnapshot = gpsService.getStatusSnapshot();

    // Road Navigation State (Phase 2)
    this.activeNavigationRoute = null;
    this.navigationLeg = null; // 'pickup' | 'destination'
    this.currentStepIndex = 0;
    this.remainingKm = null;
    this.remainingMin = null;
    this.isOffRoute = false;
    this.offRouteDistanceMeters = 0;
    this.showAllSteps = false;
    this.isRecalculating = false;

    // Re-render driver view when driver location or active ride updates
    store.subscribe('driverLocation', (loc) => {
      if (store.getState().currentMode === 'driver') {
        this.updateTelemetryValues();
      }
      this.handleDriverLocationUpdate(loc);
    });

    store.subscribe('activeRide', (ride) => {
      this.handleActiveRideChange(ride);
      if (ride?.driverId === store.getState().currentUser.id) store.setDriverAvailability([RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED].includes(ride.status) ? DRIVER_STATUS.ONLINE : DRIVER_STATUS.IN_RIDE);
      if (store.getState().currentMode === 'driver') {
        this.render();
      }
    });

    // Re-render when GPS status changes (permission, accuracy, last update)
    gpsService.onStatusChange((snapshot) => {
      this.gpsSnapshot = snapshot;
      if (store.getState().currentMode === 'driver') {
        this.renderGpsStatusPanel();
        this.updateTelemetryValues();
      }
    });
  }

  updateTelemetryValues() {
    const { driverLocation } = store.getState();
    const latEl = document.getElementById('telemetry-lat');
    const lngEl = document.getElementById('telemetry-lng');
    const speedEl = document.getElementById('telemetry-speed');
    if (latEl) latEl.innerText = (driverLocation.lat == null ? 'Waiting for GPS' : driverLocation.lat.toFixed(5));
    if (lngEl) lngEl.innerText = (driverLocation.lng == null ? 'Waiting for GPS' : driverLocation.lng.toFixed(5));
    if (speedEl) speedEl.innerText = `${Math.round(driverLocation.speed || 0)} km/h`;
  }

  render() {
    if (!this.container) return;
    const state = store.getState();
    const { currentUser, driverAvailability, driverLocation, activeRide, driverEarnings, completedTrips } = state;

    const isBusy = activeRide && ![RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED].includes(activeRide.status);
    const isOnline = isBusy || driverAvailability === DRIVER_STATUS.ONLINE;
    const phaseTitle = activeRide?.status === RIDE_STATUS.DRIVER_ARRIVED
      ? 'Arrived at pickup'
      : activeRide?.status === RIDE_STATUS.IN_PROGRESS ? 'Journey to destination' : 'Navigating to pickup';

    this.container.innerHTML = `
      <div class="driver-dashboard-layout">
        <!-- Prominent Online/Offline Availability Header -->
        <div class="driver-status-card ${isOnline ? 'online' : 'offline'}">
          <div class="driver-status-meta">
            <span class="driver-status-indicator"></span>
            <div>
              <div class="driver-status-title">${isBusy ? "On a trip" : isOnline ? "You're Online" : "You're Offline"}</div>
              <div class="driver-status-caption">${isBusy ? 'Finish or decline this request before going offline' : isOnline ? 'Enable GPS to receive nearby requests' : 'Switch online to accept ride requests'}</div>
            </div>
          </div>
          <button class="btn-driver-toggle" id="btn-toggle-availability" ${isBusy || this.isActionLoading ? 'disabled' : ''}>
            ${isOnline ? 'Go Offline' : 'Go Online'}
          </button>
        </div>

        <!-- Shift Summary -->
        <div class="driver-stats-bar">
          <div class="driver-stat-col">
            <span class="driver-stat-num">${CURRENCY_SYMBOL}${driverEarnings.toFixed(2)}</span>
            <span class="driver-stat-label">Session earnings</span>
          </div>
          <div class="driver-stat-divider"></div>
          <div class="driver-stat-col">
            <span class="driver-stat-num">${completedTrips.length}</span>
            <span class="driver-stat-label">Trips</span>
          </div>
          <div class="driver-stat-divider"></div>
          <div class="driver-stat-col">
            <span class="driver-stat-num">4.92 ★</span>
            <span class="driver-stat-label">Rating</span>
          </div>
        </div>

        <!-- Vehicle Info -->
        <div class="driver-car-row">
          <div class="driver-car-icon">${Icons.car}</div>
          <div class="driver-car-text">
            <span class="driver-car-name">${escapeHtml(currentUser.vehicle?.model || 'Maruti Suzuki Dzire')}</span>
            <span class="driver-car-plate">Plate: <strong>${escapeHtml(currentUser.vehicle?.numberPlate || 'WB-02-GPS-1001')}</strong></span>
          </div>
          <span class="driver-role-tag">Partner (D1)</span>
        </div>

        <!-- Incoming Ride Offer -->
        ${
          activeRide && activeRide.status === RIDE_STATUS.DRIVER_ASSIGNED && activeRide.driverId === currentUser.id
            ? `
          <div class="incoming-offer-panel">
            <div class="incoming-offer-header">
              <span class="incoming-offer-badge">NEW RIDE OFFER</span>
              <span class="incoming-offer-fare">${CURRENCY_SYMBOL}${(activeRide.estimatedFare || 60.00).toFixed(2)}</span>
            </div>

            <div class="incoming-itinerary">
              <div class="incoming-itinerary-step">
                <div class="itinerary-bullet pickup"></div>
                <div>
                  <span class="itinerary-bullet-type">PICKUP (~${activeRide.distanceKm || '2.5'} km)</span>
                  <span class="itinerary-bullet-addr">${escapeHtml(activeRide.pickupAddress || state.pickup.address)}</span>
                </div>
              </div>
              <div class="incoming-itinerary-step">
                <div class="itinerary-bullet dest"></div>
                <div>
                  <span class="itinerary-bullet-type">DESTINATION</span>
                  <span class="itinerary-bullet-addr">${escapeHtml(activeRide.destAddress || state.destination.address)}</span>
                </div>
              </div>
            </div>

            <button class="btn-driver-cta primary" id="btn-accept-ride" ${this.isActionLoading ? 'disabled' : ''}>
              <span>${this.isActionLoading ? 'Accepting dispatch...' : 'ACCEPT TRIP (D1)'}</span>
              ${Icons.arrowRight}
            </button>
            <button class="btn-driver-cta secondary" id="btn-reject-ride">Decline request</button>
          </div>
        `
            : ''
        }

        <!-- Active Trip Progression Card -->
        ${
          activeRide && activeRide.driverId === currentUser.id && ![RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED, RIDE_STATUS.DRIVER_ASSIGNED].includes(activeRide.status)
            ? `
          <div class="active-trip-panel">
            <div class="active-trip-header">
              <div>
                <span class="active-trip-phase">${activeRide.status.replace('_', ' ')}</span>
                <h3 class="active-trip-heading">${phaseTitle}</h3>
              </div>
              <span class="active-trip-price">${CURRENCY_SYMBOL}${(activeRide.estimatedFare || 60.00).toFixed(2)}</span>
            </div>

            <div class="active-passenger-row">
              <div class="passenger-avatar">${Icons.user}</div>
              <div class="passenger-details">
                <span class="passenger-name">${escapeHtml(activeRide.rider?.name || 'Rohan Sen')}</span>
                <span class="passenger-contact">Phone: ${escapeHtml(activeRide.rider?.phone || '+91 98300 01111')}</span>
              </div>
            </div>

            <div class="active-target-box">
              <span class="target-title">DESTINATION POINT</span>
              <span class="target-address">
                ${escapeHtml(activeRide.status === RIDE_STATUS.IN_PROGRESS ? (activeRide.destAddress || state.destination.address) : (activeRide.pickupAddress || state.pickup.address))}
              </span>
            </div>

            <!-- Clear Next Valid Action -->
            ${
              activeRide.status === RIDE_STATUS.DRIVER_ASSIGNED || activeRide.status === RIDE_STATUS.DRIVER_ARRIVING
                ? `
              <div class="trip-action-row">
                <button class="btn-driver-cta secondary" id="btn-force-arrive" title="Mark arrival at pickup immediately">
                  <span>Mark Arrived at Pickup</span>
                </button>

              </div>
            `
                : ''
            }

            ${
              activeRide.status === RIDE_STATUS.DRIVER_ARRIVED
                ? `
              <div class="trip-arrived-banner">
                <span class="banner-badge">VEHICLE AT PICKUP</span>
                <span>Passenger boarding in progress</span>
              </div>
              <button class="btn-driver-cta primary" id="btn-start-ride" ${this.isActionLoading ? 'disabled' : ''}>
                <span>${this.isActionLoading ? 'Starting trip...' : 'START TRIP (PASSENGER ONBOARD)'}</span>
                ${Icons.arrowRight}
              </button>
            `
                : ''
            }

            ${
              activeRide.status === RIDE_STATUS.IN_PROGRESS
                ? `
              <button class="btn-driver-cta success" id="btn-complete-ride" ${this.isActionLoading ? 'disabled' : ''}>
                <span>${this.isActionLoading ? 'Completing trip...' : 'COMPLETE TRIP & COLLECT FARE'}</span>
                ${Icons.check}
              </button>
            `
                : ''
            }
          </div>
        `
            : ''
        }

        <!-- Road Navigation Panel (Phase 2) -->
        ${this._renderNavigationPanelHTML()}

        <!-- Road Routing & Telemetry Controls -->
        <div class="driver-telemetry-panel">
          <div class="telemetry-top">
            <span class="telemetry-label">LIVE DEVICE LOCATION</span>
            <span class="telemetry-h3">Road navigation</span>
          </div>

          <div class="telemetry-values">
            <span>Lat: <strong id="telemetry-lat">${(driverLocation.lat == null ? 'Waiting for GPS' : driverLocation.lat.toFixed(5))}</strong></span>
            <span>Lng: <strong id="telemetry-lng">${(driverLocation.lng == null ? 'Waiting for GPS' : driverLocation.lng.toFixed(5))}</strong></span>
            <span>Speed: <strong id="telemetry-speed">${Math.round(driverLocation.speed || 0)} km/h</strong></span>
          </div>

          <!-- Real GPS Control Panel -->
          ${this._renderGpsPanelHTML()}


        </div>
      </div>
    `;

    this.attachDriverEvents();
    // Re-attach GPS status panel events after full re-render
    this._attachGpsEvents();
  }

  /**
   * Render GPS status panel HTML based on current gpsSnapshot
   */
  _renderGpsPanelHTML() {
    const snap = this.gpsSnapshot;
    const status = snap.status;
    const isActive = status === GPS_STATUS.ACTIVE;
    const isRequesting = status === GPS_STATUS.REQUESTING;
    const hasError = status === GPS_STATUS.ERROR || status === GPS_STATUS.INSECURE;
    const isStopped = status === GPS_STATUS.IDLE || status === GPS_STATUS.STOPPED;

    let statusLabel = 'Not connected';
    let statusClass = 'gps-idle';
    let lastUpdate = '';
    let accuracyInfo = '';

    if (isActive) {
      statusLabel = 'Live GPS Active ✅';
      statusClass = 'gps-active';
      if (snap.lastUpdateTime) {
        const secs = Math.round((Date.now() - snap.lastUpdateTime) / 1000);
        lastUpdate = `Last update: ${secs}s ago`;
      }
      if (snap.accuracy != null) {
        accuracyInfo = `Accuracy: ±${Math.round(snap.accuracy)}m`;
      }
    } else if (isRequesting) {
      statusLabel = 'Requesting GPS permission...';
      statusClass = 'gps-requesting';
    } else if (hasError) {
      statusLabel = snap.lastError || 'GPS unavailable';
      statusClass = 'gps-error';
    }

    return `
      <div class="gps-live-panel" id="gps-live-panel">
        <div class="gps-panel-header">
          <span class="gps-panel-title">${Icons.gps} Real Driver GPS (D1)</span>
          <span class="gps-status-badge ${statusClass}">${isActive ? '● LIVE' : isRequesting ? '◌ Requesting...' : hasError ? '✕ Error' : '○ Off'}</span>
        </div>

        ${isActive ? `
          <div class="gps-info-row">
            <span class="gps-info-label">${lastUpdate}</span>
            <span class="gps-info-label">${accuracyInfo}</span>
          </div>
          <div class="gps-info-row">
            <span class="gps-info-note">${snap.lastSharedTime ? 'Server accepted GPS at ' + new Date(snap.lastSharedTime).toLocaleTimeString() : 'Waiting for server confirmation...' }</span>
          </div>
        ` : ''}

        ${snap.sharingError ? `<div class="gps-error-box" role="alert">${escapeHtml(snap.sharingError)}</div>` : ''}
        ${hasError ? `
          <div class="gps-error-box">
            <span>${escapeHtml(snap.lastError || 'GPS error')}</span>
          </div>
        ` : ''}

        ${status === GPS_STATUS.INSECURE ? `
          <div class="gps-warning-box">
            <span>⚠️ HTTPS required for GPS on phones. See <strong>NETWORK_SETUP.md</strong> for phone setup instructions.</span>
          </div>
        ` : ''}

        <div class="gps-control-row">
          ${isActive ? `
            <button class="btn-gps-connect" id="btn-gps-recenter" style="margin-right: 8px;">
              <span>🎯 Center Map on D1</span>
            </button>
            <button class="btn-gps-disconnect" id="btn-gps-stop">
              <span>⏹ Disconnect Live GPS</span>
            </button>
          ` : `
            <button class="btn-gps-connect ${isRequesting ? 'requesting' : ''}" id="btn-gps-start" ${isRequesting ? 'disabled' : ''}>
              ${Icons.gps}
              <span>${isRequesting ? 'Awaiting permission...' : 'Enable Live GPS (D1)'}</span>
            </button>
          `}
        </div>

        ${isStopped ? `
          <p class="gps-hint">Connect to broadcast your phone's real location to the rider map. GPS requires permission and HTTPS on mobile.</p>
        ` : ''}
      </div>
    `;
  }

  /**
   * Lightweight re-render of just the GPS panel (no full re-render)
   */
  renderGpsStatusPanel() {
    const panel = document.getElementById('gps-live-panel');
    if (panel) {
      panel.outerHTML = this._renderGpsPanelHTML();
      this._attachGpsEvents();
      this.updateTelemetryValues();
    }
  }

  _getManeuverIcon(type = '', modifier = '') {
    if (type === 'arrive') return '🏁';
    if (type === 'roundabout') return '🔄';
    if (modifier.includes('uturn')) return '↩️';
    if (modifier.includes('sharp left') || modifier.includes('slight left') || modifier.includes('left')) return '⬅️';
    if (modifier.includes('sharp right') || modifier.includes('slight right') || modifier.includes('right')) return '➡️';
    return '⬆️';
  }

  /**
   * Render Turn-by-Turn Road Navigation Panel
   */
  _renderNavigationPanelHTML() {
    if (!this.activeNavigationRoute) return '';

    const route = this.activeNavigationRoute;
    const steps = route.steps || [];
    const currentStep = steps[this.currentStepIndex] || steps[0] || { instruction: 'Follow road ahead', distanceMeters: 0 };
    const nextStep = steps[this.currentStepIndex + 1];
    const icon = this._getManeuverIcon(currentStep.type, currentStep.modifier);
    const legLabel = this.navigationLeg === 'pickup' ? 'PICKUP ROAD NAVIGATION' : 'DESTINATION ROAD NAVIGATION';

    return `
      <div class="driver-nav-panel ${this.isOffRoute ? 'off-route' : ''}" id="driver-nav-panel">
        <div class="nav-panel-header">
          <div class="nav-leg-badge ${this.navigationLeg || 'pickup'}">${legLabel}</div>
          <div class="nav-eta-box">
            <span class="nav-eta-time" id="nav-eta-time">${this.remainingMin ?? route.durationMin} min</span>
            <span class="nav-eta-dist" id="nav-eta-dist">${this.remainingKm ?? route.distanceKm} km remaining</span>
          </div>
        </div>

        ${this.isOffRoute ? `
          <div class="nav-offroute-banner">
            <span class="offroute-icon">⚠️</span>
            <div class="offroute-text">
              <strong>Off Route (${this.offRouteDistanceMeters}m deviation)</strong>
              <span>${this.isRecalculating ? 'Recalculating road route...' : 'Off assigned road route.'}</span>
            </div>
            <button class="btn-recalc-manual" id="btn-recalculate-route" ${this.isRecalculating ? 'disabled' : ''}>
              ${this.isRecalculating ? 'Calculating...' : 'Recalculate'}
            </button>
          </div>
        ` : ''}

        <div class="nav-current-maneuver">
          <div class="maneuver-icon-box">${icon}</div>
          <div class="maneuver-info">
            <div class="maneuver-instruction">${escapeHtml(currentStep.instruction)}</div>
            <div class="maneuver-dist">${currentStep.distanceMeters > 0 ? `In ${currentStep.distanceMeters} m` : 'Ahead'}</div>
          </div>
        </div>

        ${nextStep ? `
          <div class="nav-next-step">
            <span class="next-label">Then:</span>
            <span class="next-inst">${escapeHtml(nextStep.instruction)}</span>
          </div>
        ` : ''}

        <div class="nav-steps-expand">
          <button class="btn-toggle-steps" id="btn-toggle-steps">
            ${this.showAllSteps ? 'Hide Full Turn-by-Turn List ▲' : `Show All Steps (${steps.length}) ▼`}
          </button>
          ${this.showAllSteps ? `
            <div class="nav-steps-list">
              ${steps.map((st, i) => `
                <div class="nav-step-item ${i === this.currentStepIndex ? 'active' : i < this.currentStepIndex ? 'done' : ''}">
                  <span class="step-num">${i + 1}</span>
                  <span class="step-icon">${this._getManeuverIcon(st.type, st.modifier)}</span>
                  <div class="step-text">
                    <div class="step-inst">${escapeHtml(st.instruction)}</div>
                    <div class="step-sub">${st.distanceMeters}m · ${escapeHtml(st.streetName || 'Road')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  handleActiveRideChange(ride) {
    if (!ride || ride.status === RIDE_STATUS.COMPLETED || ride.status === RIDE_STATUS.CANCELLED) {
      this.clearNavigation();
      return;
    }

    const currentUser = store.getState().currentUser;
    const isAssignedToMe = ride.driverId === currentUser.id;
    if (!isAssignedToMe) {
      this.clearNavigation();
      return;
    }

    if (ride.status === RIDE_STATUS.DRIVER_ASSIGNED || ride.status === RIDE_STATUS.DRIVER_ARRIVING) {
      if (this.navigationLeg !== 'pickup' || !this.activeNavigationRoute) {
        this.initOrUpdateNavigation(false);
      }
    } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      if (this.navigationLeg !== 'destination' || !this.activeNavigationRoute) {
        this.initOrUpdateNavigation(false);
      }
    } else if (ride.status === RIDE_STATUS.DRIVER_ARRIVED) {
      if (this.navigationLeg === 'pickup') {
        mapManager.clearDriverNavigationLine();
      }
    }
  }

  async initOrUpdateNavigation(force = false) {
    const state = store.getState();
    const ride = state.activeRide;
    if (!ride) return;

    const currentLoc = state.driverLocation;
    if (!Number.isFinite(currentLoc.lat) || !Number.isFinite(currentLoc.lng)) return;
    let target = null;
    let leg = null;

    if (ride.status === RIDE_STATUS.DRIVER_ASSIGNED || ride.status === RIDE_STATUS.DRIVER_ARRIVING) {
      leg = 'pickup';
      target = {
        lat: ride.pickupLat ?? state.pickup.lat,
        lng: ride.pickupLng ?? state.pickup.lng,
      };
    } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      leg = 'destination';
      target = {
        lat: ride.destLat ?? state.destination.lat,
        lng: ride.destLng ?? state.destination.lng,
      };
    }

    if (!target || !leg) return;
    const navigationId = this.navigationId = (this.navigationId || 0) + 1;
    if (!force && this.navigationLeg === leg && this.activeNavigationRoute) return;

    try {
      this.isRecalculating = true;
      const route = await routingService.getDrivingRoute(currentLoc, target);
      if (navigationId !== this.navigationId || store.getState().activeRide?.id !== ride.id || store.getState().activeRide?.status !== ride.status) return;
      this.activeNavigationRoute = route;
      this.navigationLeg = leg;
      this.currentStepIndex = 0;
      this.remainingKm = route.distanceKm;
      this.remainingMin = route.durationMin;
      this.isOffRoute = false;
      this.offRouteDistanceMeters = 0;

      if (leg === 'pickup') {
        mapManager.drawDriverToPickupRoute(route.coordinates);
      } else {
        mapManager.drawRoadRoute(route.coordinates);
      }

      if (state.currentMode === 'driver') {
        this.render();
      }
    } catch (err) {
      console.warn('Navigation route calculation error:', err);
    } finally {
      this.isRecalculating = false;
    }
  }

  handleDriverLocationUpdate(loc) {
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    if (!this.activeNavigationRoute) { if (!this.isRecalculating) this.initOrUpdateNavigation(); return; }

    const progress = routingService.calculateRemainingProgress(loc, this.activeNavigationRoute.coordinates);
    if (!progress) return;

    this.remainingKm = progress.remainingKm;
    this.remainingMin = progress.remainingMin;
    this.offRouteDistanceMeters = progress.distanceToRouteMeters;

    // Check off-route (>80m)
    if (progress.isOffRoute) {
      if (!this.isOffRoute) {
        this.isOffRoute = true;
        toast.info(`Off route (${progress.distanceToRouteMeters}m deviation). Recalculating route...`);
        this.recalculateRoute(loc);
      }
    } else {
      this.isOffRoute = false;
    }

    // Step advancement: check if driver reached next step maneuver location
    const steps = this.activeNavigationRoute.steps || [];
    if (steps.length > this.currentStepIndex + 1) {
      const nextStep = steps[this.currentStepIndex + 1];
      if (nextStep && nextStep.location) {
        const distToManeuver = routingService.haversineDistance(loc, nextStep.location);
        if (distToManeuver < 35) {
          this.currentStepIndex++;
        }
      }
    }

    // Dynamic UI update if navigation panel elements exist
    const etaTimeEl = document.getElementById('nav-eta-time');
    const etaDistEl = document.getElementById('nav-eta-dist');
    if (etaTimeEl) etaTimeEl.innerText = `${this.remainingMin} min`;
    if (etaDistEl) etaDistEl.innerText = `${this.remainingKm} km remaining`;
  }

  async recalculateRoute(loc) {
    if (this.isRecalculating) return;
    this.isRecalculating = true;
    const navigationId = this.navigationId = (this.navigationId || 0) + 1;
    const state = store.getState();
    const ride = state.activeRide;
    if (!ride) {
      this.isRecalculating = false;
      return;
    }

    let target = null;
    if (this.navigationLeg === 'pickup') {
      target = { lat: ride.pickupLat ?? state.pickup.lat, lng: ride.pickupLng ?? state.pickup.lng };
    } else if (this.navigationLeg === 'destination') {
      target = { lat: ride.destLat ?? state.destination.lat, lng: ride.destLng ?? state.destination.lng };
    }

    if (!target) {
      this.isRecalculating = false;
      return;
    }

    try {
      const newRoute = await routingService.getDrivingRoute(loc, target);
      if (navigationId !== this.navigationId || store.getState().activeRide?.id !== ride.id || store.getState().activeRide?.status !== ride.status) return;
      this.activeNavigationRoute = newRoute;
      this.currentStepIndex = 0;
      this.remainingKm = newRoute.distanceKm;
      this.remainingMin = newRoute.durationMin;
      this.isOffRoute = false;
      this.offRouteDistanceMeters = 0;

      if (this.navigationLeg === 'pickup') {
        mapManager.drawDriverToPickupRoute(newRoute.coordinates);
      } else {
        mapManager.drawRoadRoute(newRoute.coordinates);
      }
      toast.success('Road route recalculated from your current GPS position.');
      if (state.currentMode === 'driver') {
        this.render();
      }
    } catch (e) {
      console.warn('Route recalculation failed:', e);
    } finally {
      this.isRecalculating = false;
    }
  }

  clearNavigation() {
    this.navigationId = (this.navigationId || 0) + 1;
    this.activeNavigationRoute = null;
    this.navigationLeg = null;
    this.currentStepIndex = 0;
    this.remainingKm = null;
    this.remainingMin = null;
    this.isOffRoute = false;
    this.offRouteDistanceMeters = 0;
    this.isRecalculating = false;
    mapManager.clearDriverNavigationLine();
  }

  attachDriverEvents() {
    const currentUser = store.getState().currentUser;
    document.getElementById('btn-toggle-availability')?.addEventListener('click', async () => {
      if (this.isActionLoading) return;
      const next = store.getState().driverAvailability === DRIVER_STATUS.ONLINE ? DRIVER_STATUS.OFFLINE : DRIVER_STATUS.ONLINE;
      this.isActionLoading = true;
      try {
        const result = await apiClient.updateDriverStatus(currentUser.id, next);
        store.setDriverAvailability(result.data.status);
        if (next === DRIVER_STATUS.OFFLINE) { gpsService.stop(); this.clearNavigation(); }
        toast.success(next === DRIVER_STATUS.ONLINE ? 'Online. Enable GPS to receive nearby requests.' : 'You are offline.');
      } catch (error) { toast.error(error.message); }
      finally { this.isActionLoading = false; this.render(); }
    });
    const actions = [
      ['btn-accept-ride', ride => apiClient.acceptRide(ride.id, currentUser.id), 'Trip accepted'],
      ['btn-reject-ride', ride => apiClient.declineRide(ride.id), 'Request declined'],
      ['btn-force-arrive', ride => apiClient.arriveRide(ride.id), 'Arrival confirmed'],
      ['btn-start-ride', ride => apiClient.startRide(ride.id), 'Trip started'],
      ['btn-complete-ride', ride => apiClient.completeRide(ride.id), 'Trip completed'],
    ];
    for (const [id, action, message] of actions) {
      document.getElementById(id)?.addEventListener('click', async () => {
        const ride = store.getState().activeRide;
        if (!ride || this.isActionLoading) return;
        this.isActionLoading = true; this.render();
        try {
          const result = await action(ride);
          if (result.data.released) {
            store.releaseDriverRide(ride.id);
          }
          else store.setActiveRide(result.data);
          if (result.data.status === RIDE_STATUS.COMPLETED) store.addCompletedTrip(result.data);
          toast.success(message);
          await this.initOrUpdateNavigation(true);
        } catch (error) { toast.error(error.message); }
        finally { this.isActionLoading = false; this.render(); }
      });
    }
    document.getElementById('btn-toggle-steps')?.addEventListener('click', () => { this.showAllSteps = !this.showAllSteps; this.render(); });
    document.getElementById('btn-recalculate-route')?.addEventListener('click', () => this.recalculateRoute(store.getState().driverLocation));
  }

  /**
   * Attach GPS start/stop button events (called after GPS panel renders)
   */
  _attachGpsEvents() {
    document.getElementById('btn-gps-start')?.addEventListener('click', () => {
      const { driverAvailability } = store.getState();
      if (![DRIVER_STATUS.ONLINE, DRIVER_STATUS.IN_RIDE].includes(driverAvailability)) {
        toast.error('Go online first before enabling Live GPS.');
        return;
      }
      toast.info('Requesting GPS permission...');
      gpsService.start();
    });

    document.getElementById('btn-gps-stop')?.addEventListener('click', () => {
      gpsService.stop();
      toast.info('Live GPS disconnected.');
    });

    document.getElementById('btn-gps-recenter')?.addEventListener('click', () => {
      mapManager.recenterOnDriver(DEMO_USERS.driver1.id);
      toast.info('Map centered on Driver 1');
    });
  }
}
