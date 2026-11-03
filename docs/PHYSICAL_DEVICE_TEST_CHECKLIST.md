# PHYSICAL DEVICE (D1 ANDROID) ACCEPTANCE TEST CHECKLIST

This checklist guides manual verification using a physical Android smartphone for Driver 1 (D1) with real hardware GPS.

---

## Prerequisites Setup

- [ ] **Network:** Android phone and host laptop are connected to the exact same Wi-Fi network or mobile hotspot.
- [ ] **Certificate Authority Installation:**
  - Transfer `.certs/phone-rootCA.crt` to the Android phone (via USB, email, or local drive).
  - On Android: Open **Settings** → **Security & privacy** (or **Biometrics and security**) → **More security settings** → **Encryption & credentials** → **Install a certificate** → **CA certificate**.
  - Select `phone-rootCA.crt` and confirm installation ("Install anyway").
- [ ] **Open Browser:** Open Chrome on Android and navigate to `https://<LAPTOP-LAN-IP>:5173` (e.g. `https://192.168.1.12:5173`).
- [ ] **Verify Secure Context:** Ensure the padlock icon appears in the Chrome address bar with NO SSL/certificate warnings.

---

## Test Execution Steps

### 1. D1 Sign-In & GPS Permissions
- [ ] Sign in with credentials:
  - **Email:** `driver1@demo.com`
  - **Password:** `password123`
- [ ] Verify driver dashboard loads showing Driver 1 profile and Tata Tigor EV vehicle info.
- [ ] Toggle driver status to **ONLINE**.
- [ ] Tap **Enable Live GPS** button.
- [ ] Verify browser permission prompt: "Allow MIRO to access this device's location?".
- [ ] First Test (Permission Denial): Tap "Don't allow". Verify UI shows clean error state and does NOT substitute fake coordinates.
- [ ] Second Test (Permission Grant): Tap "Enable Live GPS" again and select "While using the app" / "Precise".
- [ ] Verify GPS indicator changes from "REQUESTING" to "ACTIVE" with real accuracy in meters (e.g., `< 25m`).
- [ ] Verify D1 circular marker renders at your actual geographic location on the map.

### 2. Live GPS Telemetry Transmission
- [ ] Walk 20–50 meters outdoors or near a window.
- [ ] Verify the D1 marker updates smoothly along your physical path.
- [ ] Open the rider interface on the laptop (`https://localhost:5173`) and verify D1 appears as a nearby online driver with matching real-time coordinates.

### 3. Proximity-Based Matching Verification
- [ ] On the laptop rider interface, select a pickup location within 200–500 meters of your phone's real location.
- [ ] Select a destination (e.g. Victoria Memorial or Park Street).
- [ ] Request ride.
- [ ] Verify the backend H3 matching system selects D1 because D1 is physically nearest.
- [ ] Verify incoming offer card pops up on the Android phone with a 45-second countdown timer.

### 4. End-to-End Ride Execution
- [ ] On the Android phone, tap **Accept Offer**.
- [ ] Verify both phone and laptop update status to **Driver Arriving**.
- [ ] On the Android phone, tap **Arrived at Pickup**.
- [ ] Verify both screens update status to **Driver Arrived**.
- [ ] On the Android phone, tap **Start Trip**.
- [ ] Verify both screens update status to **Ride in Progress**.
- [ ] On the Android phone, tap **Complete Trip**.
- [ ] Verify both screens display ride completion summary with calculated final fare.
- [ ] Verify D1 availability status returns to **ONLINE** on the phone.

### 5. Failure & Edge Case Scenarios
- [ ] **Decline Offer:** Request another ride, let D1 receive offer, and tap **Decline**. Verify backend re-dispatches to the next simulated driver (D2) or cancels cleanly.
- [ ] **Offer Expiry:** Request a ride, do not tap anything on the phone for 45 seconds. Verify offer automatically expires and unassigns on the phone.
- [ ] **Network Loss & Reconnection:** While in active ride, toggle Airplane Mode ON for 10 seconds, then OFF. Verify Socket.IO reconnects and restores current ride state without errors.
- [ ] **Offline Guard:** Tap **Go Offline** on the phone. Verify D1 marker disappears from the rider's nearby driver search.

