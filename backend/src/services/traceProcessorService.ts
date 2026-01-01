import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { WorkingTraceProcessor, TraceProcessorFactory } from './workingTraceProcessor';

export interface TraceInfo {
  id: string;
  filename: string;
  size: number;
  uploadTime: Date;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  error?: string;
  metadata?: {
    duration?: number;
    startTime?: number;
    endTime?: number;
    numEvents?: number;
    packages?: string[];
  };
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  durationMs: number;
  error?: string;
}

export interface TraceProcessor {
  id: string;
  traceId: string;
  status: 'initializing' | 'ready' | 'busy' | 'error';
  query(sql: string): Promise<QueryResult>;
  destroy(): void;
}

/**
 * Manages trace files and processors using the actual Perfetto Trace Processor WASM
 */
export class TraceProcessorService extends EventEmitter {
  private traces: Map<string, TraceInfo> = new Map();
  private processors: Map<string, TraceProcessor> = new Map();
  private uploads: Map<string, any> = new Map();
  private uploadDir: string;

  constructor(uploadDir = './uploads/traces') {
    super();
    this.uploadDir = path.resolve(uploadDir);
    this.ensureUploadDir();
  }

  private ensureUploadDir(): void {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Initialize a trace upload
   */
  public async initializeUpload(filename: string, size: number): Promise<string> {
    const traceId = uuidv4();
    const traceInfo: TraceInfo = {
      id: traceId,
      filename,
      size,
      uploadTime: new Date(),
      status: 'uploading',
    };

    this.traces.set(traceId, traceInfo);
    this.emit('trace-initialized', traceInfo);

    return traceId;
  }

  /**
   * Initialize a trace upload with a specific ID
   * Use this when you already have a trace ID (e.g., from a file upload)
   */
  public async initializeUploadWithId(traceId: string, filename: string, size: number): Promise<void> {
    const traceInfo: TraceInfo = {
      id: traceId,
      filename,
      size,
      uploadTime: new Date(),
      status: 'uploading',
    };

    this.traces.set(traceId, traceInfo);
    this.emit('trace-initialized', traceInfo);
  }

  /**
   * Handle chunk upload for large files
   */
  public async uploadChunk(traceId: string, chunk: Buffer, offset: number): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    const filePath = this.getTraceFilePath(traceId);

    // Create write stream if not exists
    if (!this.uploads.has(traceId)) {
      const writeStream = fs.createWriteStream(filePath, { flags: 'w' });
      this.uploads.set(traceId, writeStream);
    }

    const writeStream = this.uploads.get(traceId);

    // Write chunk at specific offset
    return new Promise((resolve, reject) => {
      // For simplicity, we'll append chunks
      // In production, you might want to use random access for better performance
      writeStream.write(chunk, (error: any) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Complete the upload and start processing
   */
  public async completeUpload(traceId: string): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    // Close write stream
    const writeStream = this.uploads.get(traceId);
    if (writeStream) {
      writeStream.end();
      this.uploads.delete(traceId);
    }

    // Update status
    trace.status = 'processing';
    this.emit('trace-status-changed', trace);

    // Start processing
    await this.processTrace(traceId);
  }

  /**
   * Process the uploaded trace file
   */
  private async processTrace(traceId: string): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    try {
      // Create a processor instance
      const processor = await this.createProcessor(traceId);
      this.processors.set(traceId, processor);

      // Extract metadata
      const metadata = await this.extractMetadata(processor);
      trace.metadata = metadata;

      trace.status = 'ready';
      this.emit('trace-processed', trace);
      this.emit('trace-status-changed', trace);
    } catch (error: any) {
      console.error(`[TraceProcessorService] Failed to process trace ${traceId}:`, error.message);
      trace.status = 'error';
      trace.error = error.message;
      this.emit('trace-status-changed', trace);
    }
  }

  /**
   * Create a new Trace Processor instance
   */
  private async createProcessor(traceId: string): Promise<TraceProcessor> {
    const filePath = this.getTraceFilePath(traceId);

    // Use the working trace processor
    const processor = await TraceProcessorFactory.create(traceId, filePath);

    // Store reference
    this.processors.set(traceId, processor);

    return processor;
  }

  /**
   * Extract basic metadata from the trace
   */
  private async extractMetadata(processor: TraceProcessor): Promise<TraceInfo['metadata']> {
    try {
      // Query basic trace information
      const result = await processor.query(`
        SELECT
          MIN(ts) as startTime,
          MAX(ts) as endTime,
          COUNT(*) as numEvents
        FROM slice
        UNION ALL
        SELECT
          MIN(ts) as startTime,
          MAX(ts) as endTime,
          COUNT(*) as numEvents
        FROM counter
        LIMIT 1
      `);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const startTime = row[0];
        const endTime = row[1];
        const numEvents = row[2];

        return {
          startTime,
          endTime,
          duration: endTime - startTime,
          numEvents,
        };
      }

      return {};
    } catch (error) {
      console.error('Failed to extract metadata:', error);
      return {};
    }
  }

  /**
   * Execute a SQL query on a trace
   */
  public async query(traceId: string, sql: string): Promise<QueryResult> {
    const processor = this.processors.get(traceId);
    if (!processor) {
      throw new Error(`No processor for trace ${traceId}`);
    }

    return await processor.query(sql);
  }

  /**
   * Get trace information
   */
  public getTrace(traceId: string): TraceInfo | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get the HTTP port of the trace processor for a given trace
   * This port can be used by the frontend to connect via HTTP RPC mode
   * Only returns port if the processor is actually ready
   */
  public getProcessorPort(traceId: string): number | undefined {
    const processor = this.processors.get(traceId) as WorkingTraceProcessor | undefined;
    // Only return port if processor is ready
    return (processor?.status === 'ready') ? processor.httpPort : undefined;
  }

  /**
   * Get trace info with processor port for frontend
   */
  public getTraceWithPort(traceId: string): (TraceInfo & { port?: number; processor?: { status: string } }) | undefined {
    const trace = this.traces.get(traceId);
    if (!trace) return undefined;

    const processor = this.processors.get(traceId) as WorkingTraceProcessor | undefined;
    // Only return port if processor is actually ready (not in error state)
    const port = (processor?.status === 'ready') ? processor.httpPort : undefined;
    return {
      ...trace,
      port,
      processor: processor ? { status: processor.status } : undefined,
    };
  }

  /**
   * Register an external RPC connection (frontend already connected to trace_processor)
   * This allows AI analysis to work with traces loaded via external HTTP RPC
   * @param traceId - A generated trace ID for this external connection
   * @param port - The port number where trace_processor is running
   * @param traceName - Display name for the trace
   */
  public async registerExternalRpc(traceId: string, port: number, traceName: string): Promise<void> {
    console.log(`[TraceProcessorService] Registering external RPC: ${traceId} on port ${port}`);

    // Create a trace info entry for this external connection
    const traceInfo: TraceInfo = {
      id: traceId,
      filename: traceName,
      size: 0, // Unknown size for external traces
      uploadTime: new Date(),
      status: 'ready', // Assume it's ready since frontend is already connected
    };

    this.traces.set(traceId, traceInfo);

    // Create a proxy processor that uses the existing HTTP RPC connection
    const processor = await TraceProcessorFactory.createFromExternalRpc(traceId, port);
    this.processors.set(traceId, processor);

    console.log(`[TraceProcessorService] External RPC registered successfully: ${traceId}`);
    this.emit('trace-processed', traceInfo);
  }

  /**
   * Load trace from disk if it exists but is not in memory
   * This is useful after server restart when traces are on disk but not loaded
   */
  public async loadTraceFromDisk(traceId: string): Promise<TraceInfo | undefined> {
    // Already in memory
    if (this.traces.has(traceId)) {
      return this.traces.get(traceId);
    }

    // Check if metadata file exists
    const metadataPath = path.join(this.uploadDir, `${traceId}.json`);
    const tracePath = this.getTraceFilePath(traceId);

    if (!fs.existsSync(tracePath)) {
      console.log(`[TraceProcessorService] Trace file not found: ${tracePath}`);
      return undefined;
    }

    try {
      let traceInfo: TraceInfo;

      // Try to load metadata from JSON file
      if (fs.existsSync(metadataPath)) {
        const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataRaw);
        traceInfo = {
          id: traceId,
          filename: metadata.filename || `${traceId}.trace`,
          size: metadata.size || fs.statSync(tracePath).size,
          uploadTime: new Date(metadata.uploadedAt || Date.now()),
          status: 'ready',
          metadata: metadata.metadata,
        };
      } else {
        // Create basic metadata from trace file
        const stats = fs.statSync(tracePath);
        traceInfo = {
          id: traceId,
          filename: `${traceId}.trace`,
          size: stats.size,
          uploadTime: new Date(stats.mtime),
          status: 'ready',
        };
      }

      // Register in memory
      this.traces.set(traceId, traceInfo);

      // Create processor
      const processor = await this.createProcessor(traceId);
      this.processors.set(traceId, processor);

      console.log(`[TraceProcessorService] Loaded trace from disk: ${traceId}`);
      return traceInfo;
    } catch (error: any) {
      console.error(`[TraceProcessorService] Failed to load trace from disk:`, error.message);
      return undefined;
    }
  }

  /**
   * Get or load trace - checks memory first, then tries to load from disk
   */
  public async getOrLoadTrace(traceId: string): Promise<TraceInfo | undefined> {
    const trace = this.getTrace(traceId);
    if (trace) {
      return trace;
    }
    return this.loadTraceFromDisk(traceId);
  }

  /**
   * Get all traces
   */
  public getAllTraces(): TraceInfo[] {
    return Array.from(this.traces.values());
  }

  /**
   * Delete a trace
   */
  public async deleteTrace(traceId: string): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    // Destroy processor
    const processor = this.processors.get(traceId);
    if (processor) {
      processor.destroy();
      this.processors.delete(traceId);
    }

    // Delete file
    const filePath = this.getTraceFilePath(traceId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from memory
    this.traces.delete(traceId);
    this.emit('trace-deleted', traceId);
  }

  /**
   * Load a trace directly from a file path (for CLI/testing use)
   * This copies the file to the upload directory and processes it
   */
  public async loadTraceFromFilePath(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const traceId = uuidv4();

    // Create trace info
    const traceInfo: TraceInfo = {
      id: traceId,
      filename,
      size: stats.size,
      uploadTime: new Date(),
      status: 'processing',
    };

    this.traces.set(traceId, traceInfo);
    this.emit('trace-initialized', traceInfo);

    // Copy file to upload directory
    const destPath = this.getTraceFilePath(traceId);
    fs.copyFileSync(filePath, destPath);

    // Process the trace
    await this.processTrace(traceId);

    return traceId;
  }

  /**
   * Get file path for a trace
   */
  private getTraceFilePath(traceId: string): string {
    return path.join(this.uploadDir, `${traceId}.trace`);
  }

  /**
   * Cleanup old traces (older than maxAge)
   * Note: This only cleans up old traces, not all processors
   */
  public async cleanup(maxAge = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const tracesToDelete: string[] = [];

    for (const [traceId, trace] of this.traces) {
      if (now - trace.uploadTime.getTime() > maxAge) {
        tracesToDelete.push(traceId);
      }
    }

    if (tracesToDelete.length > 0) {
      console.log(`[TraceProcessorService] Cleaning up ${tracesToDelete.length} old traces`);
      for (const traceId of tracesToDelete) {
        await this.deleteTrace(traceId);
      }
    }
    // Note: Don't call TraceProcessorFactory.cleanup() here as it would
    // destroy ALL processors, not just those for deleted traces.
    // The deleteTrace() method already handles processor cleanup for each trace.
  }
}

// Singleton instance for sharing across route modules
let _singletonInstance: TraceProcessorService | null = null;

export function getTraceProcessorService(): TraceProcessorService {
  if (!_singletonInstance) {
    _singletonInstance = new TraceProcessorService();
  }
  return _singletonInstance;
}