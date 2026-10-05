import { Router } from 'express';
import { simulatorController } from '../controllers/simulator.controller.js';

const router = Router();

router.post('/start', simulatorController.start);
router.post('/stop', simulatorController.stop);
router.get('/status', simulatorController.getStatus);

export default router;
