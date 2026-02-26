import { Router } from 'express';
import {
  startSession,
  analyzeWithAI,
  getProactiveInsights,
  predictIssues,
  getSession,
  updatePreferences,
  deleteSession,
  executeQuery,
  getSmartSummary,
  getLearningStats,
  getLearningReport,
  triggerLearning,
} from '../controllers/advancedAIController';
import { authenticate } from '../middleware/auth';

/**
 * @deprecated Legacy route surface for `/api/ai`.
 * Prefer `/api/agent/*` endpoints and keep this router disabled by default.
 */
const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Session management
router.post('/session/start', startSession);
router.get('/session/:sessionId', getSession);
router.put('/session/:sessionId/preferences', updatePreferences);
router.delete('/session/:sessionId', deleteSession);

// AI analysis
router.post('/analyze', analyzeWithAI);

// Proactive features
router.get('/insights/:traceId', getProactiveInsights);
router.get('/predict/:traceId', predictIssues);
router.get('/summary/:traceId', getSmartSummary);

// Query execution
router.post('/query', executeQuery);

// SQL Learning system
router.get('/learning/stats', getLearningStats);
router.get('/learning/report', getLearningReport);
router.post('/learning/train', triggerLearning);

export default router;
