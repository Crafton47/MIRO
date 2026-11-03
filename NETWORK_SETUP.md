# D1 real GPS: trusted phone and laptop setup

Current Wi-Fi laptop address (2026-11-03): **192.168.1.8**.
Phone: **https://192.168.1.8:5173**. Laptop: **https://localhost:5173**.
Both use the same Vite HTTPS proxy for `/api` and `/socket.io`; PostgreSQL and Redis remain on the backend.

## One-time setup on Windows

1. Install mkcert (`winget install --id FiloSottile.mkcert -e`) and reopen PowerShell if it is not on PATH.
2. From the project root run `npm run setup:https -- -LanIp 192.168.1.8`.
   This creates `.certs/miro.pem` and its private key outside the frontend root, and installs the development CA in the current Windows user's trust store. Accept Windows' certificate installation dialog if shown. The CA is for development on devices you control.
3. Transfer **only `.certs/phone-rootCA.crt`** to your phone using USB or another trusted file-transfer method. Never transfer `rootCA-key.pem` or `miro-key.pem`. These files are ignored by Git and are not served by Vite.
4. Android: in Settings search for **Install a certificate**, choose **CA certificate**, and select `phone-rootCA.crt`. Menu wording varies. Use Chrome and confirm that the site has no certificate warning.
5. iPhone: open the certificate, install its profile under Settings > General > VPN & Device Management (or Profile Downloaded), then enable it under Settings > General > About > Certificate Trust Settings > Enable full trust for root certificates.
6. Keep both devices on the same Wi-Fi/hotspot. If Windows Firewall blocks access, allow Node.js on the **Private** network or create a Private/LocalSubnet inbound TCP rule for **5173 only**. Do not expose database or Redis ports for phone use.

## Start and use MIRO

1. Keep PostgreSQL and Redis running with your existing backend configuration. Stop the old Vite process if it was started before these changes, then run `npm run dev` from the project root.
2. Laptop: open **https://localhost:5173**, sign in as `rider@miro.local` using the existing password (seed default: `password123`).
3. Phone: open **https://192.168.1.8:5173**, sign in as `driver1@miro.local` (seed default: `password123`). This account's user ID maps to D1's driver profile; a new driver account is not D1. Do not reseed an existing database just to sign in.
4. Tap **Go Online**, then **Enable Live GPS (D1)**. Allow site location access and enable device Location Services/precise location.
5. Keep the phone browser visible and screen awake. Wait outdoors for an accepted reading (accuracy at most 100 m, age at most 15 s). Check the GPS panel for **Server accepted GPS at ...**, and Mobile Connect for secure context and authenticated Socket.IO connectivity.
6. Watch the blue D1 marker on the laptop. Its coordinate is the actual accepted device reading, without road snapping or simulated movement. GPS accuracy still limits physical precision. Move safely and compare the driver telemetry coordinates with the rider marker. D2-D8 retain their existing simulation behavior.

If DHCP changes the laptop address, rerun setup with the new address and use the new printed URL. The CA normally stays the same, so the phone need not reinstall it. `MIRO_TLS_KEY` and `MIRO_TLS_CERT` can point to an equivalent trusted certificate containing the laptop address. `MIRO_HTTPS=false` is a laptop-only loopback HTTP mode, not a phone GPS solution.

## Why the old path failed

- `http://localhost` is a special potentially trustworthy loopback origin. On a phone, localhost refers to the phone, not the laptop. An ordinary HTTP LAN address is not a secure geolocation context.
- The previous frontend `.env` forced both API and Socket.IO to `http://localhost:3000`, defeating the same-origin proxy on phones and conflicting with HTTPS.
- Automatic basic-SSL certificates were self-signed, not trusted on the phone. An HTTPS URL alone does not establish certificate trust. Do not click through certificate errors or enable insecure-origin flags.
- `main.js` called a missing `socketClient.onError` method, aborting startup before local GPS subscriptions were installed.
- Upload failures were conflated with GPS errors, timeout retry could leave an old watch running, and the rider map bypassed timestamp checks for D1 socket updates.

## Diagnostics and manual acceptance checks

- Insecure context: use the HTTPS URL and install the CA; check Mobile Connect's Secure context indicator.
- Permission denied: allow this exact origin in browser site permissions and allow location for the browser in OS settings; retry. Permissions do not carry over from HTTP or localhost to the LAN HTTPS origin.
- Unavailable/timeout: enable location, move to open sky, retry. Transient errors keep watching; Retry replaces the watcher safely.
- Update failed 401: sign in again. 403: verify D1 account. 409: go online. Network/timeout: check the proxy/backend and Wi-Fi. The panel distinguishes a local fix from the last server acknowledgment.
- Socket authentication failure: Mobile Connect and the connection badge tooltip show it. Sign in again; a server-expired connection requires a new session. No anonymous room access is added.
- When D1 has an active ride, precise updates go to that ride's rider and D1, not other riders. Without a ride, the existing authenticated fleet broadcast remains. Nearby discovery responses retain their existing coarse coordinates; those are not used to place D1's live marker.
- Real-phone checks still required: certificate trust, OS/browser permission prompts, actual sensor accuracy, walking movement on both maps, Wi-Fi interruption/reconnection, permission revocation, screen locking/background suspension, offline/online and a complete real D1 ride. Browsers may suspend location in the background; this is not a native background-tracking app.

## References

- [MDN: watchPosition secure context and permission requirements](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)
- [mkcert: mobile CA installation](https://github.com/FiloSottile/mkcert#mobile-devices)
- [Apple: manually trust certificate profiles](https://support.apple.com/en-au/102390)
- [Vite HTTPS and proxy configuration](https://vite.dev/config/server-options)
