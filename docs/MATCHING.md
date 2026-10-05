# H3 Driver Matching & Proximity Algorithm

## Overview
The matching engine selects up to **8 best candidate drivers** for a ride request using a 2-stage spatial lookup and ranking strategy.

```
Rider Pickup Lat/Lng
         |
         v
Convert to H3 Cell (Res 8)
         |
         v
Find Surrounding H3 Cells (k-ring search: k=0, 1, 2, 3...)
         |
         v
Fetch Available Drivers from Redis (Set `h3:<cell>:drivers`)
         |
         v
Filter by Status == 'ONLINE'
         |
         v
Calculate Distance (Haversine formula in km) & ETA (Estimated Time of Arrival)
         |
         v
Sort by Proximity / Distance
         |
         v
Return Top 8 Available Drivers
```

## Details

1. **Resolution**: Uber H3 Resolution 8 is used (~0.737 sq km hex area, ~460m edge length).
2. **K-Ring Radius Expansion**:
   - Initial lookup at `k=0` (rider's hex).
   - If candidate count < 8, expand to `k=1` (7 hexes total), `k=2` (19 hexes total), `k=3` (37 hexes total).
3. **Distance Calculation**:
   - Straight-line geodesic distance (Haversine formula).
   - Speed assumption for MVP ETA fallback: ~30 km/h urban average speed.
4. **Ranking & Cutoff**:
   - Filter out drivers in `IN_RIDE` or `OFFLINE` status.
   - Sort by computed distance ascending.
   - Truncate list to top 8 drivers max.
