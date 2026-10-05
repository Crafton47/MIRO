import * as h3 from 'h3-js';
import { env } from '../../config/env.js';

export class H3Service {
  private readonly resolution: number;

  constructor(resolution = env.H3_RESOLUTION) {
    this.resolution = resolution;
  }

  /**
   * Convert latitude and longitude coordinates into an H3 hex cell index
   */
  public latLngToCell(lat: number, lng: number): string {
    return h3.latLngToCell(lat, lng, this.resolution);
  }

  /**
   * Get surrounding H3 cells up to a given ring radius k (0 = center only, 1 = 7 hexes, 2 = 19 hexes, etc.)
   */
  public getSurroundingCells(h3Index: string, kRingRadius = 2): string[] {
    return h3.gridDisk(h3Index, kRingRadius);
  }

  /**
   * Check if a given string is a valid H3 cell index
   */
  public isValidCell(h3Index: string): boolean {
    return h3.isValidCell(h3Index);
  }

  /**
   * Get center coordinate (lat/lng) of an H3 cell
   */
  public cellToLatLng(h3Index: string): [number, number] {
    return h3.cellToLatLng(h3Index);
  }
}

export const h3Service = new H3Service();
