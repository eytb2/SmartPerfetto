import { Router } from 'express';
import SqlController from '../controllers/sqlController';
import { authenticate, checkUsage } from '../middleware/auth';

const router = Router();
const sqlController = new SqlController();

// GET /api/sql/tables - Get available Perfetto tables schema (public)
router.get('/tables', sqlController.getTablesSchema);

// POST /api/sql/generate - Generate Perfetto SQL from natural language (protected)
router.post('/generate', authenticate, checkUsage(false), sqlController.generateSql);

export default router;