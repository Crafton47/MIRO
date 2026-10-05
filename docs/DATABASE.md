# Database & Cache Schema Design

## PostgreSQL / PostGIS Schema (Prisma)

### Tables & Key Attributes

#### `User`
- `id` (UUID, Primary Key)
- `email` (String, Unique)
- `phone` (String, Unique)
- `passwordHash` (String)
- `name` (String)
- `role` (Enum: `RIDER`, `DRIVER`, `ADMIN`)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)

#### `Driver`
- `id` (UUID, Primary Key)
- `userId` (UUID, FK -> User.id, Unique)
- `status` (Enum: `OFFLINE`, `ONLINE`, `IN_RIDE`)
- `rating` (Float, Default: 5.0)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)

#### `Vehicle`
- `id` (UUID, Primary Key)
- `driverId` (UUID, FK -> Driver.id, Unique)
- `vehicleType` (String, e.g. "SEDAN", "SUV", "BIKE")
- `model` (String)
- `numberPlate` (String, Unique)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)

#### `Ride`
- `id` (UUID, Primary Key)
- `riderId` (UUID, FK -> User.id)
- `driverId` (UUID, FK -> Driver.id, Nullable)
- `status` (Enum: `REQUESTED`, `SEARCHING`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`)
- `pickupLat` (Float), `pickupLng` (Float)
- `destLat` (Float), `destLng` (Float)
- `pickupAddress` (String), `destAddress` (String)
- `distanceKm` (Float, Nullable)
- `durationMin` (Float, Nullable)
- `estimatedFare` (Float)
- `finalFare` (Float, Nullable)
- `startedAt` (Timestamp, Nullable)
- `completedAt` (Timestamp, Nullable)
- `cancelledAt` (Timestamp, Nullable)
- `createdAt` (Timestamp)
- `updatedAt` (Timestamp)

---

## Redis In-Memory State Strategy

- Driver GPS is saved in Redis key `driver:location:<driverId>`
- Active H3 cells maintain Sets of online driver IDs: `h3:<h3Index>:drivers`
- When a driver moves hexes, their ID is removed from the old hex set and added to the new hex set.
