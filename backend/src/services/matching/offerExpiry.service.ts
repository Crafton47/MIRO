import { prisma } from '../../config/prisma.js';
import { rideService } from '../ride/ride.service.js';
import { socketServer } from '../../websocket/socket.server.js';
import { logger } from '../../utils/logger.js';

export class OfferExpiryService {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastWarnTime = 0;
  private previouslyUnreachable = false;

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), 5000);
    this.timer.unref();
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  public async sweep(now = Date.now()) {
    if (this.running) return;
    this.running = true;
    try {
      // updatedAt is persisted; expired offers are recovered after a server restart.
      const offers = await prisma.ride.findMany({
        where: { status: 'DRIVER_ASSIGNED', updatedAt: { lt: new Date(now - 45000) } },
        select: { id: true, driverId: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      });

      if (this.previouslyUnreachable) {
        this.previouslyUnreachable = false;
        logger.info('Database connected: ride offer expiry checks active.');
      }

      for (const offer of offers) {
        if (!offer.driverId) continue;
        try {
          const ride = await rideService.declineRide(offer.id, offer.driverId);
          socketServer.emitUnassigned(offer.driverId, offer.id, 'timeout');
          socketServer.emitRide(ride);
        } catch (error: any) {
          // Accept/cancel/reassignment can legitimately win the race.
          if (!['P2025', 'P2034', 'STATE_CONFLICT'].includes(error.code)) {
            logger.warn('Offer expiry retry deferred');
          }
        }
      }
    } catch (err: any) {
      const nowMs = Date.now();
      const isDbOffline =
        err?.name === 'PrismaClientInitializationError' ||
        err?.message?.includes("Can't reach database server") ||
        err?.code === 'P1001';

      if (nowMs - this.lastWarnTime > 60_000) {
        this.lastWarnTime = nowMs;
        this.previouslyUnreachable = true;
        if (isDbOffline) {
          logger.warn('Offer expiry check deferred: PostgreSQL database is unreachable. Retrying in background...');
        } else {
          logger.warn(`Offer expiry database check unavailable: ${err?.message || 'unknown error'}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const offerExpiryService = new OfferExpiryService();
