import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import TraceController from '../controllers/traceController';
import { authenticate, checkUsage } from '../middleware/auth';

const router = Router();
const traceController = new TraceController();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    // Keep the original filename
    cb(null, file.originalname);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  // Accept .perfetto and .trace files
  if (file.originalname.endsWith('.perfetto') || file.originalname.endsWith('.trace')) {
    cb(null, true);
  } else {
    cb(new Error('Only .perfetto and .trace files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '2147483648'), // 2GB default
  },
});

// POST /api/trace/upload - Upload a trace file (protected)
router.post('/upload', authenticate, upload.single('file'), traceController.uploadTrace);

// POST /api/trace/analyze - Analyze an uploaded trace (protected, with usage check)
router.post('/analyze', authenticate, checkUsage(true), traceController.analyzeTrace);

// GET /api/trace/:fileId - Get trace file information (protected)
router.get('/:fileId', authenticate, traceController.getTraceInfo);

// DELETE /api/trace/:fileId - Delete a trace file (protected)
router.delete('/:fileId', authenticate, traceController.deleteTrace);

// GET /api/trace/:fileId/download - Download a trace file (protected)
router.get('/:fileId/download', authenticate, traceController.downloadTrace);

export default router;