# REST API Specification

Base Endpoint: `/api/v1`

## Error Response Format
All errors return a uniform structure:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable description"
  }
}
```

## Endpoints

### Auth
- `POST /auth/register` - Register rider or driver
- `POST /auth/login` - Authenticate user & receive JWT token

### Drivers
- `POST /drivers` - Create driver profile (requires DRIVER role user)
- `GET /drivers/:id` - Fetch driver profile & vehicle details
- `PATCH /drivers/:id/status` - Update status (`OFFLINE`, `ONLINE`, `IN_RIDE`)
- `PATCH /drivers/:id/location` - HTTP fallback for driver location update
- `GET /drivers/nearby` - Search nearby drivers using query `lat`, `lng`, `radiusKm`

### Rides
- `POST /rides/estimate` - Estimate fare for `pickupLat`, `pickupLng`, `destLat`, `destLng`
- `POST /rides` - Request a ride (`riderId`, `pickupLat`, `pickupLng`, `destLat`, `destLng`, `pickupAddress`, `destAddress`)
- `GET /rides/:id` - Get ride details and current state
- `POST /rides/:id/accept` - Driver accepts ride (`driverId`)
- `POST /rides/:id/start` - Driver starts ride
- `POST /rides/:id/complete` - Driver completes ride
- `POST /rides/:id/cancel` - Rider or driver cancels ride (`reason`)
