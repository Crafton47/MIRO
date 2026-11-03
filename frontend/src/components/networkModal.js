import { escapeHtml } from '../utils/escape.js';
import { apiClient } from '../api/client.js';
import { socketClient } from '../api/socket.js';
import { API_BASE_URL, WS_BASE_URL } from '../utils/constants.js';
import { toast } from '../utils/toast.js';

class NetworkModal {
  constructor() {
    this.isOpen = false;
    this.networkData = null;
    this.pingResult = null;
    this.isPinging = false;
  }

  async open() {
    this.isOpen = true;
    try {
      const res = await apiClient.getNetworkInfo();
      if (res && res.data) {
        this.networkData = res.data;
      }
    } catch {
      // Fallback network data using window.location
      const host = window.location.hostname || 'localhost';
      this.networkData = {
        lanIps: [host],
        primaryLanIp: host,
        backendPort: 3000,
        frontendPort: 5173,
        mobileDriverUrl: `${window.location.protocol}//${host}:5173`,
        backendUrl: `http://${host}:3000`,
      };
    }
    this.render();
  }

  close() {
    this.isOpen = false;
    const modalEl = document.getElementById('network-modal-overlay');
    if (modalEl) modalEl.remove();
  }

  async runPingTest() {
    this.isPinging = true;
    this.render();

    const startTime = performance.now();
    try {
      const res = await apiClient.getHealth();
      const elapsed = Math.round(performance.now() - startTime);
      const isWsConnected = socketClient.status === 'connected';

      this.pingResult = {
        success: true,
        latencyMs: elapsed,
        wsStatus: isWsConnected ? 'Connected' : socketClient.status,
      };
      toast.success(`Ping successful! Round-trip latency: ${elapsed}ms`);
    } catch (err) {
      this.pingResult = {
        success: false,
        error: err.message,
      };
      toast.error(`Ping failed: ${err.message}`);
    } finally {
      this.isPinging = false;
      this.render();
    }
  }

  render() {
    let overlay = document.getElementById('network-modal-overlay');
    if (!this.isOpen) {
      if (overlay) overlay.remove();
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'network-modal-overlay';
      overlay.className = 'network-modal-overlay';
      document.body.appendChild(overlay);
    }

    const host = window.location.hostname;
    const isMobileOrigin = host !== 'localhost' && host !== '127.0.0.1';
    const mobileUrl = isMobileOrigin ? window.location.origin : `${window.location.protocol}//${this.networkData?.primaryLanIp || host}:5173`;
    const backendUrl = API_BASE_URL;
    const wsStatus = socketClient.status;

    overlay.innerHTML = `
      <div class="network-modal-container">
        <div class="network-modal-header">
          <div class="network-modal-title-wrap">
            <span class="network-modal-badge">CONNECTIVITY</span>
            <h2 class="network-modal-title">📱 Laptop & Mobile Setup (Driver 1 GPS)</h2>
          </div>
          <button class="network-modal-close" id="btn-close-network-modal" title="Close">✕</button>
        </div>

        <div class="network-modal-body">
          <!-- Connection Status Card -->
          <div class="net-diag-card">
            <div class="net-diag-header">
              <span class="net-diag-h3">Live Diagnostic Status</span>
              <span class="net-status-badge ${wsStatus === 'connected' ? 'online' : 'offline'}">
                ${wsStatus === 'connected' ? '● WebSocket Online' : '○ ' + wsStatus}
              </span>
            </div>
            <p>Secure context: ${window.isSecureContext ? 'Yes' : 'No ? trusted HTTPS required for phone GPS'}</p>
            ${socketClient.lastError ? `<p role="alert">${escapeHtml(socketClient.lastError)}</p>` : ''}
            <div class="net-diag-grid">
              <div class="net-diag-col">
                <span class="diag-lbl">App Origin:</span>
                <span class="diag-val">${escapeHtml(window.location.origin)}</span>
              </div>
              <div class="net-diag-col">
                <span class="diag-lbl">Backend API:</span>
                <span class="diag-val">${escapeHtml(backendUrl)}</span>
              </div>
              <div class="net-diag-col">
                <span class="diag-lbl">WebSocket:</span>
                <span class="diag-val">${escapeHtml(WS_BASE_URL)}</span>
              </div>
            </div>

            <div class="net-ping-row">
              <button class="btn-diag-ping" id="btn-run-ping" ${this.isPinging ? 'disabled' : ''}>
                <span>${this.isPinging ? 'Measuring latency...' : '⚡ Test Communication (Ping)'}</span>
              </button>
              ${this.pingResult ? `
                <span class="ping-output ${this.pingResult.success ? 'success' : 'error'}">
                  ${this.pingResult.success 
                    ? `✓ Response: ${this.pingResult.latencyMs}ms | WS: ${this.pingResult.wsStatus}` 
                    : `✕ Failed: ${escapeHtml(this.pingResult.error)}`}
                </span>
              ` : ''}
            </div>
          </div>

          <!-- Step 1: Open on Phone -->
          <div class="net-step-card">
            <div class="net-step-num">1</div>
            <div class="net-step-content">
              <h3 class="net-step-title">Open MIRO on your Mobile Phone</h3>
              <p class="net-step-p">Ensure your laptop and phone are connected to the <strong>same Wi-Fi network</strong> or your <strong>mobile phone's hotspot</strong>.</p>
              
              <div class="mobile-url-box">
                <span class="mobile-url-text" id="mobile-url-text">${escapeHtml(mobileUrl)}</span>
                <button class="btn-copy-url" id="btn-copy-mobile-url">
                  <span>Copy URL</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Step 2: Switch to Driver Partner Tab -->
          <div class="net-step-card">
            <div class="net-step-num">2</div>
            <div class="net-step-content">
              <h3 class="net-step-title">Sign in as the driver</h3>
              <p class="net-step-p">Use your D1 driver account on the phone and a rider account on the laptop. Each device keeps its own authenticated session.</p>
            </div>
          </div>

          <!-- Step 3: Enable Real GPS on Mobile -->
          <div class="net-step-card highlight">
            <div class="net-step-num">3</div>
            <div class="net-step-content">
              <h3 class="net-step-title">Enable Live GPS over trusted HTTPS</h3>
              <p class="net-step-p">Use the HTTPS address configured for this laptop and trust its local development certificate on your phone. See NETWORK_SETUP.md for setup. Plain HTTP on a LAN address cannot provide secure browser geolocation.</p>
              <ol class="net-ol"><li>Sign in and go online.</li><li>Tap Enable Live GPS and allow location access.</li><li>Wait for an accurate reading. D1 stays unpositioned until a real reading arrives.</li></ol>
            </div>
          </div>

          <!-- Step 4: Verification -->
          <div class="net-step-card">
            <div class="net-step-num">4</div>
            <div class="net-step-content">
              <h3 class="net-step-title">Verify Live Dual-Device Tracking</h3>
              <p class="net-step-p">Once enabled, walk or move with your phone. The real mobile GPS coordinates, heading, and accuracy will stream live to the backend and reflect on the laptop Rider's map in real time!</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Attach events
    document.getElementById('btn-close-network-modal')?.addEventListener('click', () => this.close());
    overlay.onclick = e => { if (e.target === overlay) this.close(); };
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Laptop and phone setup');

    document.getElementById('btn-copy-mobile-url')?.addEventListener('click', () => {
      navigator.clipboard.writeText(mobileUrl).then(() => {
        toast.success('Mobile URL copied to clipboard!');
      }).catch(() => {
        toast.info(`URL: ${escapeHtml(mobileUrl)}`);
      });
    });

    document.getElementById('btn-run-ping')?.addEventListener('click', () => {
      this.runPingTest();
    });
  }
}

export const networkModal = new NetworkModal();
