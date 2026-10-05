# WebSocket Event Specifications

## Socket.IO Namespaces & Channels

- Server URL: `ws://localhost:3000` (or `http://localhost:3000`)
- Authentication: Handled via `auth.token` handshake query or JWT payload.

## Events (Client -> Server)

### `driver:location`
Emitted by real driver app or simulator.
Payload:
```json
{
  "driverId": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "heading": 180,
  "speed": 15.5
}
```

### `driver:online` / `driver:offline`
Payload:
```json
{
  "driverId": "uuid"
}
```

### `ride:request`
Payload:
```json
{
  "rideId": "uuid",
  "pickupLat": 37.7749,
  "pickupLng": -122.4194,
  "destLat": 37.7833,
  "destLng": -122.4167
}
```

### `ride:accepted` / `ride:started` / `ride:completed` / `ride:cancelled`
Payload:
```json
{
  "rideId": "uuid",
  "driverId": "uuid"
}
```

## Events (Server -> Client)

### `location:update`
Broadcasted to riders watching active driver or room.
Payload:
```json
{
  "entityType": "DRIVER",
  "entityId": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "h3Index": "8828308281fffff",
  "heading": 180,
  "timestamp": 1696500000000
}
```

### `ride:status_changed`
Payload:
```json
{
  "rideId": "uuid",
  "status": "DRIVER_ASSIGNED",
  "driver": { "id": "uuid", "name": "Driver Name", "vehicle": "Toyota Prius" }
}
```
