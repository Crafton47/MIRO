import { driverSimulatorService } from '../src/services/simulator/simulator.service.js';
import { logger } from '../src/utils/logger.js';

async function runStandaloneSimulator() {
  logger.info('==================================================');
  logger.info('🤖 Starting Standalone 7-Driver Simulator...');
  logger.info('==================================================');

  // Default coordinates centered near Kolkata MVP test region (Esplanade)
  const centerLat = process.env.CENTER_LAT ? parseFloat(process.env.CENTER_LAT) : 22.5646;
  const centerLng = process.env.CENTER_LNG ? parseFloat(process.env.CENTER_LNG) : 88.3510;
  const intervalMs = process.env.INTERVAL_MS ? parseInt(process.env.INTERVAL_MS, 10) : 3000;

  process.env.DEMO_MODE = 'true';
  await driverSimulatorService.start(centerLat, centerLng, intervalMs);

  process.on('SIGINT', () => {
    logger.info('Received SIGINT. Stopping simulator...');
    driverSimulatorService.stop();
    process.exit(0);
  });
}

runStandaloneSimulator().catch((err) => {
  logger.error('Failed to run simulator:', err);
  process.exit(1);
});
