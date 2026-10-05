import { driverSimulatorService } from '../src/services/simulator/simulator.service.js';
import { logger } from '../src/utils/logger.js';

async function runStandaloneSimulator() {
  logger.info('==================================================');
  logger.info('🤖 Starting Standalone 7-Driver Simulator...');
  logger.info('==================================================');

  // San Francisco downtown default coordinates
  const centerLat = process.env.CENTER_LAT ? parseFloat(process.env.CENTER_LAT) : 37.7749;
  const centerLng = process.env.CENTER_LNG ? parseFloat(process.env.CENTER_LNG) : -122.4194;
  const intervalMs = process.env.INTERVAL_MS ? parseInt(process.env.INTERVAL_MS, 10) : 2000;

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
