import { escapeHtml } from '../utils/escape.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_COORDS } from '../utils/constants.js';

class MapManager {
  constructor() {
    this.map = null;
    this.pickupMarker = null;
    this.destMarker = null;
    this.driverMarkers = new Map();
    this.routeLine = null;
    this.routeOutline = null;
    this.driverToPickupLine = null;
    this.onPickupDragCallback = null;
    this.onDestDragCallback = null;
    this.onMapClickCallback = null;
    this.clickTarget = 'pickup'; // 'pickup' | 'destination'
  }

  init(containerId = 'map-container') {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    try {
      this.map = L.map(containerId, {
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: true,
        minZoom: 3,
        maxZoom: 19,
        maxBounds: [[-85.06, -Infinity], [85.06, Infinity]],
        maxBoundsViscosity: 1.0,
      }).setView([DEFAULT_COORDS.center.lat, DEFAULT_COORDS.center.lng], 14);

      // Clean Zoom control on bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);

      // OpenStreetMap tile provider with proper attribution and matching zoom bounds
      const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        minZoom: 3,
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      });

      tileLayer.on('tileerror', () => {
        console.warn('Map tile loading degraded; relying on vector overlays.');
      });

      tileLayer.addTo(this.map);

      // Invalidate size once DOM stabilizes to ensure proper container tile mapping
      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, 100);

      this.map.on('click', (e) => {
        if (this.onMapClickCallback) {
          this.onMapClickCallback(e.latlng, this.clickTarget);
        }
      });
    } catch (err) {
      console.error('Leaflet initialization error:', err);
    }

    return this.map;
  }

  setClickTarget(target) {
    this.clickTarget = target;
  }

  getClickTarget() {
    return this.clickTarget;
  }

  onMapClick(callback) {
    this.onMapClickCallback = callback;
  }

  // 1. Green Pickup Marker
  setPickupMarker(lat, lng, onDrag = null) {
    if (!this.map) return;
    if (onDrag) this.onPickupDragCallback = onDrag;

    const icon = L.divIcon({
      className: 'custom-puck-icon-wrap',
      html: `
        <div class="map-marker-pickup" title="Pickup Location (Drag to change)">
          <div class="pickup-pin-dot"></div>
          <div class="pickup-pin-pulse"></div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!this.pickupMarker) {
      this.pickupMarker = L.marker([lat, lng], { icon, draggable: true, zIndexOffset: 800 }).addTo(this.map);
      this.pickupMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        if (this.onPickupDragCallback) {
          this.onPickupDragCallback(pos.lat, pos.lng);
        }
      });
    } else {
      this.pickupMarker.setLatLng([lat, lng]);
    }
  }

  // 2. Prominent Red Map Pin Destination Marker
  setDestinationMarker(lat, lng, onDrag = null) {
    if (!this.map) return;
    if (onDrag) this.onDestDragCallback = onDrag;

    const icon = L.divIcon({
      className: 'custom-dest-pin-wrap',
      html: `
        <div class="map-marker-destination" title="Destination (Drag to change)">
          <svg width="30" height="38" viewBox="0 0 30 38" fill="none" class="dest-pin-svg">
            <path d="M15 0C6.71573 0 0 6.71573 0 15C0 24.5 15 38 15 38C15 38 30 24.5 30 15C30 6.71573 23.2843 0 15 0Z" fill="#EF4444"/>
            <circle cx="15" cy="14" r="5.5" fill="#FFFFFF"/>
            <circle cx="15" cy="14" r="2.5" fill="#B91C1C"/>
          </svg>
          <div class="dest-pin-shadow"></div>
        </div>
      `,
      iconSize: [30, 38],
      iconAnchor: [15, 38],
    });

    if (!this.destMarker) {
      this.destMarker = L.marker([lat, lng], { icon, draggable: true, zIndexOffset: 900 }).addTo(this.map);
      this.destMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        if (this.onDestDragCallback) {
          this.onDestDragCallback(pos.lat, pos.lng);
        }
      });
    } else {
      this.destMarker.setLatLng([lat, lng]);
    }
  }

  // 3. Driver Vehicle Markers
  createDriverIconHtml(heading = 0, isAssigned = false, isReal = false) {
    heading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
    return `
      <div class="driver-marker-box ${isAssigned ? 'assigned' : ''} ${isReal ? 'real' : ''}">
        <div class="driver-rotator" style="transform: rotate(${heading}deg);">
          <div class="driver-arrow-tip"></div>
          <div class="driver-car-body">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/>
              <circle cx="7.5" cy="14.5" r="1.5"/>
              <circle cx="16.5" cy="14.5" r="1.5"/>
            </svg>
          </div>
        </div>
        ${isAssigned ? '<div class="assigned-radar-pulse"></div>' : ''}
      </div>
    `;
  }

  updateSingleDriverPosition(driverId, lat, lng, heading = 0) {
    if (!this.map) return;
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    // Only Driver 1 uses this method
    const isReal = driverId === '00000000-0000-4000-a000-000000000001';
    let marker = this.driverMarkers.get(driverId);

    if (!marker) {
      const icon = L.divIcon({
        className: 'custom-driver-icon-wrap real-driver-wrap',
        html: this.createDriverIconHtml(heading, true, isReal),
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      marker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
      marker.bindPopup('<div class="map-popup"><div class="popup-title">D1 — Real Driver</div><div class="popup-meta"><span>Last received device GPS fix</span></div></div>');
      this.driverMarkers.set(driverId, marker);
    } else {
      if (marker._gpsFrame) cancelAnimationFrame(marker._gpsFrame);
      // D1 represents the measured fix exactly; do not invent intermediate GPS positions.
      marker.setLatLng([lat, lng]);
      const el = marker.getElement();
      const rotator = el?.querySelector('.driver-rotator');
      if (rotator) {
        rotator.style.transform = `rotate(${heading}deg)`;
      } else {
        const icon = L.divIcon({
          className: 'custom-driver-icon-wrap real-driver-wrap',
          html: this.createDriverIconHtml(heading, true, isReal),
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        marker.setIcon(icon);
      }
    }
  }

  centerOnD1Once(lat, lng) {
    if (!this._hasCenteredOnD1 && this.map) {
      if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
        this._hasCenteredOnD1 = true;
        this.map.setView([lat, lng], 15);
      }
    }
  }

  recenterOnDriver(driverId = '00000000-0000-4000-a000-000000000001') {
    const marker = this.driverMarkers.get(driverId);
    if (marker && this.map) {
      const pos = marker.getLatLng();
      this.map.setView(pos, 15);
    }
  }

  /**
   * Update a single SIMULATED driver marker (D2-D8). Never touches D1.
   */
  updateSingleSimulatedDriver(driverId, lat, lng, heading = 0) {
    if (!this.map) return;
    // Guard: never overwrite D1
    if (driverId === '00000000-0000-4000-a000-000000000001') return;
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

    let marker = this.driverMarkers.get(driverId);
    const shortId = driverId.slice(-1);

    if (!marker) {
      const icon = L.divIcon({
        className: 'custom-driver-icon-wrap',
        html: this.createDriverIconHtml(heading, false, false),
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      marker = L.marker([lat, lng], { icon, zIndexOffset: 400 }).addTo(this.map);
      marker.bindPopup(`<div class="map-popup"><div class="popup-title">D${shortId} — Simulated Driver</div><div class="popup-meta"><span>Simulated Fleet</span></div></div>`);
      this.driverMarkers.set(driverId, marker);
    } else {
      if (marker._gpsFrame) cancelAnimationFrame(marker._gpsFrame);
      const from = marker.getLatLng();
      const started = performance.now();
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
      const move = now => {
        const fraction = duration ? Math.min(1, (now - started) / duration) : 1;
        marker.setLatLng([from.lat + (lat - from.lat) * fraction, from.lng + (lng - from.lng) * fraction]);
        if (fraction < 1) marker._gpsFrame = requestAnimationFrame(move);
      };
      marker._gpsFrame = requestAnimationFrame(move);
      const el = marker.getElement();
      const rotator = el?.querySelector('.driver-rotator');
      if (rotator) {
        rotator.style.transform = `rotate(${heading}deg)`;
      }
    }
  }

  /**
   * Remove all simulated driver markers (D2-D8) from the map.
   */
  clearSimulatedDriverMarkers() {
    for (const [id, marker] of this.driverMarkers.entries()) {
      if (id !== '00000000-0000-4000-a000-000000000001') {
        if (this.map) this.map.removeLayer(marker);
        this.driverMarkers.delete(id);
      }
    }
  }

  updateDriverMarkers(drivers = [], activeDriverId = null) {
    if (!this.map) return;

    const currentDriverIds = new Set(drivers.map((d) => d.driverId));

    // Clean up unlisted drivers except active assigned driver and NEVER remove D1
    for (const [id, marker] of this.driverMarkers.entries()) {
      if (id === activeDriverId || id === '00000000-0000-4000-a000-000000000001') continue;
      if (!currentDriverIds.has(id)) {
        this.map.removeLayer(marker);
        this.driverMarkers.delete(id);
      }
    }

    drivers.forEach((driver) => {
      // D1 is managed exclusively with real GPS via updateSingleDriverPosition
      if (driver.driverId === '00000000-0000-4000-a000-000000000001') {
        this.updateSingleDriverPosition(driver.driverId, driver.latitude, driver.longitude, driver.heading || 0);
        return;
      }
      if (typeof driver.latitude !== 'number' || typeof driver.longitude !== 'number') return;
      const isAssigned = driver.driverId === activeDriverId;
      const isReal = driver.userId === '22222222-2222-4000-a000-000000000001' || driver.driverId === '00000000-0000-4000-a000-000000000001';
      const label = isReal ? 'D1 (Real Driver Partner)' : (driver.driverName || 'Simulated Fleet');
      const heading = driver.heading || 0;

      const icon = L.divIcon({
        className: 'custom-driver-icon-wrap',
        html: this.createDriverIconHtml(heading, isAssigned, isReal),
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (!this.driverMarkers.has(driver.driverId)) {
        const marker = L.marker([driver.latitude, driver.longitude], {
          icon,
          zIndexOffset: isAssigned ? 1000 : 500,
        }).addTo(this.map);

        marker.bindPopup(`
          <div class="map-popup">
            <div class="popup-title">${escapeHtml(label)}</div>
            <div class="popup-meta">
              <span>Distance: <strong>${driver.distanceKm ? driver.distanceKm + ' km' : 'Nearby'}</strong></span>
              <span>ETA: <strong>${driver.etaMinutes ? driver.etaMinutes + ' min' : '2 min'}</strong></span>
              <span>Status: <strong>${isReal ? 'Active Driver App' : 'Simulated Fleet'}</strong></span>
            </div>
          </div>
        `);
        this.driverMarkers.set(driver.driverId, marker);
      } else {
        const marker = this.driverMarkers.get(driver.driverId);
        marker.setLatLng([driver.latitude, driver.longitude]);
        const element = marker.getElement();
        element?.querySelector('.driver-marker-box')?.classList.toggle('assigned', isAssigned);
        const rotator = element?.querySelector('.driver-rotator');
        if (rotator) rotator.style.transform = `rotate(${Number(heading) || 0}deg)`;
      }
    });
  }

  // 4. Draw Road-Following Geometry
  drawRoadRoute(points = [], color = '#0f172a') {
    if (!this.map || !points || points.length < 2) return;

    this.clearRoute();

    const latlngs = points.map((p) => [p.lat, p.lng]);

    // Outer glow / casing for high contrast
    this.routeOutline = L.polyline(latlngs, {
      color: '#ffffff',
      weight: 7,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);

    // Primary road polyline
    this.routeLine = L.polyline(latlngs, {
      color,
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
  }

  clearRoute() {
    if (this.routeLine && this.map) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
    if (this.routeOutline && this.map) {
      this.map.removeLayer(this.routeOutline);
      this.routeOutline = null;
    }
  }

  // 5. Draw Driver-To-Pickup Road Route
  drawDriverToPickupRoute(points = []) {
    if (!this.map || !points || points.length < 2) return;

    this.clearDriverNavigationLine();

    const latlngs = points.map((p) => [p.lat, p.lng]);

    this.driverToPickupLine = L.polyline(latlngs, {
      color: '#059669',
      weight: 4,
      opacity: 0.9,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
  }

  clearDriverNavigationLine() {
    if (this.driverToPickupLine && this.map) {
      this.map.removeLayer(this.driverToPickupLine);
      this.driverToPickupLine = null;
    }
  }

  // 6. Camera Fitting
  fitBounds(points = [], padding = [60, 60]) {
    if (!this.map || points.length === 0) return;
    const latlngs = points.map((p) => [p.lat, p.lng]);
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding, maxZoom: 16 });
    }
  }

  panTo(lat, lng, zoom = null) {
    if (this.map) {
      if (zoom) {
        this.map.setView([lat, lng], zoom);
      } else {
        this.map.panTo([lat, lng]);
      }
    }
  }
}

export const mapManager = new MapManager();
