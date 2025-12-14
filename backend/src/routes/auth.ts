import { Router } from 'express';
import AuthController from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();
const authController = new AuthController();

// POST /api/auth/register - Register a new user
router.post('/register', authController.register);

// POST /api/auth/login - Login user
router.post('/login', authController.login);

// GET /api/auth/profile - Get user profile (protected)
router.get('/profile', authenticate, authController.getProfile);

// POST /api/auth/subscribe - Create subscription session (protected)
router.post('/subscribe', authenticate, authController.createSubscriptionSession);

// POST /api/auth/webhook - Stripe webhook handler
router.post('/webhook', authController.handleWebhook);

export default router;