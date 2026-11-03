import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authService } from '../services/auth/auth.service.js';
import { prisma } from '../config/prisma.js';

const router = Router();

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        driver: { select: { id: true } },
      },
    });

    if (!user) {
      res.sendStatus(401);
      return;
    }

    const isEmailVerified = await authService.isEmailVerified(user.id, user.email);
    const { driver, ...profile } = user;
    res.json({
      success: true,
      data: {
        ...profile,
        driverId: driver?.id || null,
        isEmailVerified,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/verify-email', authController.verifyEmail);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);

export default router;
