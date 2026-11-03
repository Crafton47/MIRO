import { escapeHtml } from '../utils/escape.js';
import { store } from '../state/store.js';
import { apiClient } from '../api/client.js';
import { socketClient } from '../api/socket.js';
import { mapManager } from '../map/mapManager.js';
import { geocodingService } from '../services/geocodingService.js';
import { routingService } from '../services/routingService.js';
import { toast } from '../utils/toast.js';
import { POPULAR_LOCATIONS, RIDE_STATUS, VEHICLE_TIERS, CURRENCY_SYMBOL } from '../utils/constants.js';
import { Icons } from '../utils/icons.js';

export class RiderView {
  constructor(containerId = 'view-rider') {
    this.container = document.getElementById(containerId);
    this.isRequesting = false;
    this.isEstimating = false;
    this.searchDebounceTimer = null;
    this.currentRoadRoute = null;

    // Track whether inputs have resolved coordinates
    this.pickupResolved = true;
    this.destResolved = true;

    // Listen to outside clicks to close autocomplete dropdowns
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.autocomplete-wrapper')) {
        this.closeAllDropdowns();
      }
    });

    store.subscribe('activeRide', (ride) => {
      if (store.getState().currentMode === 'rider') {
        this.render();
      }
      if (ride && (ride.status === RIDE_STATUS.DRIVER_ASSIGNED || ride.status === RIDE_STATUS.DRIVER_ARRIVING)) {
        this.ensureDriverToPickupRouteOnMap(store.getState().driverLocation, ride);
      }
    });

    store.subscribe('driverLocation', (loc) => {
      const state = store.getState();
      const activeRide = state.activeRide;
      if (activeRide) {
        this.updateDriverTrackingProgress(loc, activeRide);
      }
    });
  }

  closeAllDropdowns() {
    const pickupDrop = document.getElementById('pickup-suggestions');
    const destDrop = document.getElementById('dest-suggestions');
    if (pickupDrop) pickupDrop.style.display = 'none';
    if (destDrop) destDrop.style.display = 'none';
  }

  render() {
    if (!this.container) return;
    const state = store.getState();
    const activeRide = state.activeRide;

    if (!activeRide || activeRide.status === RIDE_STATUS.CANCELLED) {
      this.renderBookingScreen();
    } else if (activeRide.status === RIDE_STATUS.COMPLETED) {
      this.renderReceiptScreen(activeRide);
    } else {
      this.renderTrackingScreen(activeRide);
    }
  }

  // 1. Consumer Booking Screen with Real Autocomplete & Mode Switcher
  renderBookingScreen() {
    const state = store.getState();
    const { pickup, destination, fareEstimate, nearbyDrivers, selectedTierId } = state;
    const selectedTier = store.getSelectedTier();
    const clickTarget = mapManager.getClickTarget();

    const baseFareAmount = fareEstimate ? fareEstimate.estimatedFare : null;

    this.container.innerHTML = `
      <div class="rider-booking-layout">
        <div class="rider-intro">
          <h1 class="rider-main-title">Get a ride</h1>
          <p class="rider-main-sub">Real road routing & live dispatch</p>
        </div>

        <!-- Map Selection Mode Indicator -->
        <div class="map-selection-mode-bar">
          <span class="mode-bar-label">Map click sets:</span>
          <div class="mode-bar-toggles">
            <button class="btn-mode-pill ${clickTarget === 'pickup' ? 'active pickup-mode' : ''}" id="btn-mode-pickup">
              <span class="pill-dot green"></span>
              <span>Pickup Point</span>
            </button>
            <button class="btn-mode-pill ${clickTarget === 'destination' ? 'active dest-mode' : ''}" id="btn-mode-dest">
              <span class="pill-dot red"></span>
              <span>Destination</span>
            </button>
          </div>
        </div>

        <!-- Connected Route Inputs with Real Autocomplete -->
        <div class="route-unified-box">
          <div class="route-connector-spine">
            <div class="spine-dot-pickup"></div>
            <div class="spine-thread"></div>
            <div class="spine-dot-dest"></div>
          </div>

          <div class="route-input-group">
            <!-- Pickup Row -->
            <div class="route-input-row autocomplete-wrapper">
              <label class="route-input-label" for="input-pickup">Pickup</label>
              <div class="route-input-field">
                <input 
                  type="text" 
                  class="clean-text-input" 
                  id="input-pickup" 
                  value="${escapeHtml(pickup.address)}" 
                  placeholder="Search street, building, or city"
                  autocomplete="off"
                />
                <div class="inline-spinner" id="spinner-pickup" style="display: none;"></div>
                <button class="btn-gps-inline" id="btn-locate-me" title="Use current GPS location">
                  ${Icons.gps}
                  <span>GPS</span>
                </button>
              </div>
              <div class="autocomplete-dropdown" id="pickup-suggestions" style="display: none;"></div>
            </div>

            <div class="route-inner-divider"></div>

            <!-- Destination Row -->
            <div class="route-input-row autocomplete-wrapper">
              <label class="route-input-label" for="input-dest">Where to?</label>
              <div class="route-input-field">
                <input 
                  type="text" 
                  class="clean-text-input" 
                  id="input-dest" 
                  value="${escapeHtml(destination.address)}" 
                  placeholder="Search destination address or place"
                  autocomplete="off"
                />
                <div class="inline-spinner" id="spinner-dest" style="display: none;"></div>
              </div>
              <div class="autocomplete-dropdown" id="dest-suggestions" style="display: none;"></div>
            </div>
          </div>
        </div>

        <!-- Quick Destination Chips -->
        <div class="quick-chips-bar">
          <span class="chips-micro-label">Quick select:</span>
          <div class="chips-scroll">
            ${POPULAR_LOCATIONS.map(
              (loc) => `
              <button 
                class="destination-chip ${destination.address === loc.address ? 'active' : ''}" 
                data-lat="${loc.lat}" 
                data-lng="${loc.lng}" 
                data-address="${loc.address}"
              >
                ${loc.name}
              </button>
            `
            ).join('')}
          </div>
        </div>

        <!-- Vehicle Ride Tiers -->
        <div class="tier-section">
          <div class="tier-section-header">
            <span class="tier-header-title">Choose a ride</span>
            ${
              fareEstimate
                ? `<span class="tier-header-meta">${fareEstimate.distanceKm} km trip • ~${fareEstimate.durationMin} min ride</span>`
                : `<span class="tier-header-meta">Calculating road route...</span>`
            }
          </div>

          <div class="tier-comparison-list">
            ${VEHICLE_TIERS.filter(tier => tier.id === 'miro_go').map((tier) => {
              const isSelected = tier.id === selectedTierId;
              const tierFare = baseFareAmount === null ? 'Estimate unavailable' : `${CURRENCY_SYMBOL}${(baseFareAmount * tier.multiplier).toFixed(2)}`;
              const closestDriver = nearbyDrivers.length > 0 ? nearbyDrivers[0] : null;
              const basePickupEta = closestDriver
                ? Math.max(1, Math.round(closestDriver.etaMinutes || (closestDriver.distanceKm * 2.5)))
                : 2;
              const eta = basePickupEta + tier.etaOffset;

              return `
                <div class="tier-row ${isSelected ? 'selected' : ''}" data-tier-id="${tier.id}">
                  <div class="tier-row-icon">
                    ${tier.id === 'miro_xl' ? Icons.carSuv : Icons.car}
                  </div>
                  <div class="tier-row-info">
                    <div class="tier-row-top">
                      <span class="tier-row-name">${tier.name}</span>
                      <span class="tier-row-seats">${Icons.user} ${tier.seats}</span>
                      ${tier.badge ? `<span class="tier-row-badge">${tier.badge}</span>` : ''}
                    </div>
                    <div class="tier-row-sub">
                      <span>${closestDriver ? `${eta} min away` : 'Checking availability'}</span> • <span class="tier-row-desc">${tier.description}</span>
                    </div>
                  </div>
                  <div class="tier-row-fare">
                    <span class="tier-price-val">${tierFare}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Upfront Guarantee Strip -->
        <div class="upfront-notice">
          ${Icons.shield}
          <span>Real road route pricing via OSRM • Autocomplete via OpenStreetMap</span>
        </div>

        <!-- Primary Booking Action -->
        <button 
          class="btn-cta-rider" 
          id="btn-request-ride" 
          ${this.isRequesting || this.isEstimating ? 'disabled' : ''}
        >
          ${
            this.isRequesting
              ? `
            <div class="rider-spinner"></div>
            <span>Dispatching nearest driver...</span>
          `
              : `
            <span>Request ${selectedTier.name} • ${baseFareAmount !== null ? `${CURRENCY_SYMBOL}${(baseFareAmount * selectedTier.multiplier).toFixed(2)}` : "Get Quote"}</span>
            ${Icons.arrowRight}
          `
          }
        </button>

        <!-- Fleet Context -->
        <div class="demo-fleet-banner">
          <div class="fleet-banner-left">
            <span class="fleet-status-beacon"></span>
            <div class="fleet-banner-text">
              <strong>Live Fleet Telemetry</strong>
              <span>
                ${
                  nearbyDrivers.length > 0
                    ? `Nearest driver: ${escapeHtml(nearbyDrivers[0].driverName)} (${nearbyDrivers[0].distanceKm} km from pickup • ~${nearbyDrivers[0].etaMinutes || 2} min)`
                    : 'Searching for nearby vehicles in dispatch area...'
                }
              </span>
            </div>
          </div>
          <button class="btn-refresh-clean" id="btn-refresh-drivers" title="Refresh nearby fleet positions">
            ${Icons.refresh}
          </button>
        </div>
      </div>
    `;

    this.attachBookingEvents();
  }

  // 2. Active Trip / Tracking Screen
  renderTrackingScreen(ride) {
    const isSearching = ride.status === RIDE_STATUS.REQUESTED || ride.status === RIDE_STATUS.SEARCHING;
    const isArrived = ride.status === RIDE_STATUS.DRIVER_ARRIVED;
    const isInProgress = ride.status === RIDE_STATUS.IN_PROGRESS;

    const driver = ride.driver;
    const state = store.getState();

    let heroTitle = 'Finding your driver...';
    let heroSub = 'Searching nearest vehicles across H3 spatial cells';

    if (isArrived) {
      heroTitle = 'Driver has arrived!';
      heroSub = 'Your driver is waiting at the pickup location';
    } else if (isInProgress) {
      heroTitle = 'Heading to destination';
      heroSub = `Navigating road route to ${ride.destAddress || 'destination'}`;
    } else if (!isSearching) {
      heroTitle = 'Driver is approaching';
      heroSub = 'Your driver partner is following the road to pickup';
    }

    this.container.innerHTML = `
      <div class="rider-tracking-layout">
        <!-- Status Header -->
        <div class="tracking-hero">
          <div class="tracking-status-pill ${isInProgress ? 'active' : isArrived ? 'arrived' : isSearching ? 'searching' : 'assigned'}">
            <span class="status-dot-pulse"></span>
            <span>${ride.status.replace('_', ' ')}</span>
          </div>

          <h2 class="tracking-title">${heroTitle}</h2>
          <p class="tracking-sub">${escapeHtml(heroSub)}</p>
        </div>

        <!-- Searching Mode Banner -->
        ${
          isSearching
            ? `
          <div class="matching-light-card">
            <div class="matching-light-progress">
              <div class="matching-light-bar"></div>
            </div>
            <div class="matching-light-text">
              <strong>Looking for closest available driver</strong>
              <span>Estimated response time: ~5 seconds</span>
            </div>
            <div class="demo-guide-box">
              <span>💡 Switch to the <strong>Driver Partner (D1)</strong> tab above to accept this trip as D1.</span>
            </div>
          </div>
        `
            : ''
        }

        <!-- Assigned Driver Card -->
        ${
          driver
            ? `
          <div class="driver-profile-light">
            <div class="driver-profile-top">
              <div class="driver-avatar-box">
                ${Icons.user}
              </div>
              <div class="driver-identity">
                <span class="driver-full-name">${escapeHtml(driver.user?.name || 'Debashis Mukherjee (D1)')}</span>
                <span class="driver-car-desc">${escapeHtml(driver.vehicle?.model || 'Maruti Suzuki Dzire')} • ${Icons.star} ${driver.rating || 4.9}</span>
              </div>
              <div class="driver-plate-tag">
                <span>${escapeHtml(driver.vehicle?.numberPlate || 'WB-02-GPS-1001')}</span>
              </div>
            </div>

            <div class="driver-profile-stats">
              <div class="stat-unit">
                <span class="stat-label">Estimated Road ETA</span>
                <span class="stat-value" id="rider-tracking-eta">${isArrived ? 'At Pickup' : '~2 min'}</span>
              </div>
              <div class="stat-unit">
                <span class="stat-label">${ride.status === RIDE_STATUS.IN_PROGRESS ? 'Distance to Dest' : 'Distance to Pickup'}</span>
                <span class="stat-value" id="rider-tracking-dist">${isArrived ? '0.00 km' : 'En Route'}</span>
              </div>
              <div class="stat-unit">
                <span class="stat-label">Trip Total</span>
                <span class="stat-value">${CURRENCY_SYMBOL}${(ride.estimatedFare || 60).toFixed(2)}</span>
              </div>
            </div>
          </div>
        `
            : ''
        }

        <!-- Itinerary Recap Card -->
        <div class="itinerary-light-card">
          <div class="itinerary-light-item">
            <div class="itinerary-light-dot pickup"></div>
            <div class="itinerary-light-content">
              <span class="itinerary-light-label">Pickup Point</span>
              <span class="itinerary-light-text">${escapeHtml(ride.pickupAddress || state.pickup.address)}</span>
            </div>
          </div>

          <div class="itinerary-light-connector"></div>

          <div class="itinerary-light-item">
            <div class="itinerary-light-dot dest"></div>
            <div class="itinerary-light-content">
              <span class="itinerary-light-label">Destination Point</span>
              <span class="itinerary-light-text">${escapeHtml(ride.destAddress || state.destination.address)}</span>
            </div>
          </div>
        </div>

        <!-- Cancel Ride Option -->
        <button class="btn-cancel-light" id="btn-cancel-ride">
          ${Icons.cross}
          <span>Cancel Trip Request</span>
        </button>
      </div>
    `;

    document.getElementById('btn-cancel-ride')?.addEventListener('click', async () => {
      try {
        const result = await apiClient.cancelRide(ride.id, 'Rider cancelled');
        store.setActiveRide(result.data);
        if (store.getState().activeRide?.id === ride.id) store.setActiveRide(null);
        toast.info('Ride request was cancelled.');
        this.render();
      } catch (err) {
        toast.error(`Cancellation failed: ${err.message}`);
      }
    });
  }

  // 3. Digital Receipt Screen
  renderReceiptScreen(ride) {
    const finalFare = parseFloat((ride.finalFare || ride.estimatedFare || 60.00)).toFixed(2);
    const baseFare = 50.00;
    const distanceFare = Math.max(10.00, parseFloat((parseFloat(finalFare) - baseFare).toFixed(2))).toFixed(2);

    this.container.innerHTML = `
      <div class="receipt-layout-light">
        <div class="receipt-badge-circle">
          ${Icons.check}
        </div>
        <h2 class="receipt-heading">Trip Completed</h2>
        <p class="receipt-sub">Thank you for riding with MIRO</p>

        <!-- Clean Paper Invoice -->
        <div class="invoice-box-light">
          <div class="invoice-total-row">
            <span class="invoice-total-label">Total Amount</span>
            <span class="invoice-total-number">${CURRENCY_SYMBOL}${finalFare}</span>
          </div>

          <div class="invoice-line-break"></div>

          <div class="invoice-row">
            <span>Base Fare</span>
            <span>${CURRENCY_SYMBOL}${baseFare.toFixed(2)}</span>
          </div>
          <div class="invoice-row">
            <span>Distance (${ride.distanceKm || '1.0'} km)</span>
            <span>${CURRENCY_SYMBOL}${distanceFare}</span>
          </div>
          <div class="invoice-row">
            <span>Payment Mode</span>
            <span>Cash / UPI (Demo)</span>
          </div>

          <div class="invoice-line-break"></div>

          <div class="invoice-summary-route">
            <div><strong>From:</strong> ${escapeHtml(ride.pickupAddress || 'Pickup Point')}</div>
            <div><strong>To:</strong> ${escapeHtml(ride.destAddress || 'Destination Point')}</div>
          </div>
        </div>

        <button class="btn-cta-rider" id="btn-new-ride">
          <span>Book Another Ride</span>
          ${Icons.arrowRight}
        </button>
      </div>
    `;

    document.getElementById('btn-new-ride')?.addEventListener('click', () => {
      store.setActiveRide(null);
      this.render();
    });
  }

  async ensureDriverToPickupRouteOnMap(loc, ride) {
    if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return;
    if (!loc || !ride) return;
    const target = { lat: ride.pickupLat || store.getState().pickup.lat, lng: ride.pickupLng || store.getState().pickup.lng };
    try {
      const route = await routingService.getDrivingRoute(loc, target);
      mapManager.drawDriverToPickupRoute(route.coordinates);
    } catch {}
  }

  updateDriverTrackingProgress(loc, ride) {
    if (!Number.isFinite(loc?.lat) || !Number.isFinite(loc?.lng)) return;
    if (!loc || !ride) return;
    const etaEl = document.getElementById('rider-tracking-eta');
    const distEl = document.getElementById('rider-tracking-dist');
    if (!etaEl && !distEl) return;

    if (ride.status === RIDE_STATUS.DRIVER_ARRIVED) {
      if (etaEl) etaEl.innerText = 'At Pickup';
      if (distEl) distEl.innerText = '0.00 km';
      return;
    }

    let targetCoords = null;
    if (ride.status === RIDE_STATUS.DRIVER_ASSIGNED || ride.status === RIDE_STATUS.DRIVER_ARRIVING) {
      targetCoords = { lat: ride.pickupLat || store.getState().pickup.lat, lng: ride.pickupLng || store.getState().pickup.lng };
    } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      targetCoords = { lat: ride.destLat || store.getState().destination.lat, lng: ride.destLng || store.getState().destination.lng };
    }

    if (targetCoords) {
      const distMeters = routingService.haversineDistance(loc, targetCoords);
      const distKm = parseFloat((distMeters / 1000).toFixed(2));
      const etaMin = Math.max(1, Math.round(distKm * 2.5));
      if (etaEl) etaEl.innerText = `~${etaMin} min`;
      if (distEl) distEl.innerText = `${distKm} km`;
    }
  }

  attachBookingEvents() {
    // Mode toggles
    const btnModePickup = document.getElementById('btn-mode-pickup');
    const btnModeDest = document.getElementById('btn-mode-dest');

    btnModePickup?.addEventListener('click', () => {
      mapManager.setClickTarget('pickup');
      btnModePickup.classList.add('active', 'pickup-mode');
      btnModeDest?.classList.remove('active', 'dest-mode');
      toast.info('Click anywhere on the map to set Pickup point.');
    });

    btnModeDest?.addEventListener('click', () => {
      mapManager.setClickTarget('destination');
      btnModeDest.classList.add('active', 'dest-mode');
      btnModePickup?.classList.remove('active', 'pickup-mode');
      toast.info('Click anywhere on the map to set Destination.');
    });

    // Autocomplete for Pickup Input
    const inputPickup = document.getElementById('input-pickup');
    const dropPickup = document.getElementById('pickup-suggestions');
    const spinPickup = document.getElementById('spinner-pickup');

    if (inputPickup && dropPickup && spinPickup) {
      this.bindAutocomplete(inputPickup, dropPickup, spinPickup, 'pickup');
    }

    // Autocomplete for Destination Input
    const inputDest = document.getElementById('input-dest');
    const dropDest = document.getElementById('dest-suggestions');
    const spinDest = document.getElementById('spinner-dest');

    if (inputDest && dropDest && spinDest) {
      this.bindAutocomplete(inputDest, dropDest, spinDest, 'dest');
    }

    // Quick chips for popular destinations
    document.querySelectorAll('.destination-chip').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const lat = parseFloat(target.dataset.lat);
        const lng = parseFloat(target.dataset.lng);
        const address = target.dataset.address;

        store.setDestination(lat, lng, address);
        this.destResolved = true;
        mapManager.setDestinationMarker(lat, lng);
        this.updateRouteAndFare();
      });
    });

    // Tier selection
    document.querySelectorAll('.tier-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        const tierId = e.currentTarget.dataset.tierId;
        store.setTier(tierId);
        this.render();
      });
    });

    // Device GPS location
    document.getElementById('btn-locate-me')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        toast.error('Geolocation is not supported by your browser.');
        return;
      }

      toast.info('Detecting device GPS coordinates...');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          toast.info('Resolving address from GPS...');

          let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          try {
            const rev = await geocodingService.reverseGeocode(lat, lng);
            if (rev && rev.address) address = rev.address;
          } catch {}

          store.setPickup(lat, lng, address);
          this.pickupResolved = true;
          mapManager.setPickupMarker(lat, lng);
          mapManager.panTo(lat, lng);
          this.updateRouteAndFare();
          this.fetchNearbyDrivers();
          toast.success('Pickup set from device GPS.');
        },
        (err) => {
          toast.error(`Location access denied (${err.message}).`);
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });

    // Refresh Drivers
    document.getElementById('btn-refresh-drivers')?.addEventListener('click', () => {
      this.fetchNearbyDrivers();
    });

    // Request Ride CTA
    document.getElementById('btn-request-ride')?.addEventListener('click', () => {
      this.handleRideRequest();
    });
  }

  /**
   * Bind interactive autocomplete to an input field
   */
  bindAutocomplete(inputEl, dropEl, spinnerEl, type) {
    inputEl.addEventListener('input', (e) => {
      const query = e.target.value.trim();

      if (type === 'pickup') this.pickupResolved = false;
      if (type === 'dest') this.destResolved = false;

      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }

      if (query.length < 2) {
        dropEl.style.display = 'none';
        spinnerEl.style.display = 'none';
        return;
      }

      spinnerEl.style.display = 'block';

      this.searchDebounceTimer = setTimeout(async () => {
        try {
          const centerCoords = store.getState().pickup;
          const suggestions = await geocodingService.searchAutocomplete(query, centerCoords, 6);

          spinnerEl.style.display = 'none';

          if (!suggestions || suggestions.length === 0) {
            dropEl.innerHTML = `
              <div class="autocomplete-empty">
                <span>No matching locations found. Click map to set point.</span>
              </div>
            `;
            dropEl.style.display = 'block';
            return;
          }

          dropEl.innerHTML = suggestions
            .map(
              (s) => `
            <div class="autocomplete-item" data-lat="${s.lat}" data-lng="${s.lng}" data-address="${encodeURIComponent(s.fullAddress)}">
              <div class="item-icon">${Icons.pin || '📍'}</div>
              <div class="item-text">
                <span class="item-title">${escapeHtml(s.title)}</span>
                <span class="item-subtitle">${escapeHtml(s.subtitle)}</span>
              </div>
            </div>
          `
            )
            .join('');

          dropEl.style.display = 'block';

          // Click listeners on suggestions
          dropEl.querySelectorAll('.autocomplete-item').forEach((item) => {
            item.addEventListener('click', () => {
              const lat = parseFloat(item.dataset.lat);
              const lng = parseFloat(item.dataset.lng);
              const address = decodeURIComponent(item.dataset.address);

              if (type === 'pickup') {
                store.setPickup(lat, lng, address);
                this.pickupResolved = true;
                mapManager.setPickupMarker(lat, lng);
                this.fetchNearbyDrivers();
              } else {
                store.setDestination(lat, lng, address);
                this.destResolved = true;
                mapManager.setDestinationMarker(lat, lng);
              }

              dropEl.style.display = 'none';
              this.updateRouteAndFare();
            });
          });
        } catch (err) {
          spinnerEl.style.display = 'none';
          dropEl.innerHTML = `
            <div class="autocomplete-error">
              <span>Search unavailable. Click anywhere on map to select.</span>
            </div>
          `;
          dropEl.style.display = 'block';
        }
      }, 300);
    });

    inputEl.addEventListener('focus', () => {
      if (dropEl.innerHTML.trim() && inputEl.value.trim().length >= 2) {
        dropEl.style.display = 'block';
      }
    });
  }

  /**
   * Recalculate true road route with OSRM and update fare estimation
   */
  async updateRouteAndFare() {
    const requestId = this.routeRequestId = (this.routeRequestId || 0) + 1;
    const { pickup, destination } = store.getState();
    this.isEstimating = true;
    this.currentRoadRoute = null;
    store.setState({ fareEstimate: null });

    try {
      // 1. Fetch real road geometry from OSRM
      const route = await routingService.getDrivingRoute(pickup, destination);
      if (requestId !== this.routeRequestId) return;
      this.currentRoadRoute = route;

      // 2. Draw real road-following polyline on map
      mapManager.drawRoadRoute(route.coordinates);
      mapManager.fitBounds([pickup, destination]);

      // 3. Query backend fare estimation endpoint with real coordinates
      const res = await apiClient.estimateFare(pickup.lat, pickup.lng, destination.lat, destination.lng);
      if (!res.success || !Number.isFinite(res.data?.estimatedFare)) throw new Error('Fare estimate unavailable. Please try again.');
      const fare = res.data;

      if (fare && requestId === this.routeRequestId) {
        store.setState({ fareEstimate: fare });
      }
    } catch (err) {
      if (requestId !== this.routeRequestId) return;
      this.currentRoadRoute = null; mapManager.clearRoute(); store.setState({ fareEstimate: null });
      console.warn('Road routing error:', err.message);
      toast.error(`Road routing notice: ${err.message}`);
    } finally {
      if (requestId === this.routeRequestId) { this.isEstimating = false; this.render(); }
    }
  }

  async fetchNearbyDrivers() {
    const requestId = this.nearbyRequestId = (this.nearbyRequestId || 0) + 1;
    const { pickup } = store.getState();
    try {
      const res = await apiClient.getNearbyDrivers(pickup.lat, pickup.lng, 8);
      const currentPickup = store.getState().pickup;
      if (requestId !== this.nearbyRequestId || pickup.lat !== currentPickup.lat || pickup.lng !== currentPickup.lng) return;
      if (res.success && Array.isArray(res.data)) {
        const sorted = [...res.data].sort((a, b) => a.distanceKm - b.distanceKm);
        store.setNearbyDrivers(sorted);
        mapManager.updateDriverMarkers(sorted, store.getState().activeRide?.driverId);
        if (!store.getState().activeRide && !this.container.contains(document.activeElement)) this.render();
      }
    } catch (err) {
      console.warn('Nearby drivers fetch warning:', err.message);
    }
  }

  async handleRideRequest() {
    const state = store.getState();
    const { pickup, destination, fareEstimate, currentUser } = state;
    if (this.isEstimating) { toast.info('Wait for the route estimate to finish.'); return; }

    if (!this.pickupResolved || !this.destResolved) {
      toast.error('Please pick an address from search suggestions or click on the map to confirm location.');
      return;
    }

    if (this.isRequesting) return;
    this.isRequesting = true;
    this.render();

    try {
      if (!fareEstimate) {
        await this.updateRouteAndFare();
        return; // Let the rider review the recovered quote before booking.
      }

      if (store.getState().pickup !== pickup || store.getState().destination !== destination) throw new Error('Locations changed. Review the new estimate before booking.');
      if (!this.currentRoadRoute || !store.getState().fareEstimate) throw new Error('Route or fare unavailable. Check the locations and try again.');
      const payload = {
        riderId: currentUser.id,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        destLat: destination.lat,
        destLng: destination.lng,
        pickupAddress: pickup.address,
        destAddress: destination.address,
      };

      const res = await apiClient.createRide(payload);

      if (res.success && res.data) {
        const createdRide = res.data.ride || res.data;
        store.setActiveRide(createdRide);

        socketClient.joinRoom(`ride:${createdRide.id}`);
        toast.success('Ride requested successfully!');
        this.render();
      }
    } catch (err) {
      toast.error(`Ride request failed: ${err.message}`);
    } finally {
      this.isRequesting = false;
      this.render();
    }
  }
}
