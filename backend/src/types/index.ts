export interface GenerateSqlRequest {
  query: string;
  context?: string;
}

export interface GenerateSqlResponse {
  sql: string;
  explanation: string;
  examples?: string[];
}

export interface TraceAnalysisRequest {
  file: Express.Multer.File;
  query?: string;
  analysisType?: 'performance' | 'memory' | 'cpu' | 'gpu' | 'custom';
}

export interface TraceAnalysisResponse {
  insights: string[];
  sqlQueries: string[];
  recommendations: string[];
  metrics?: {
    duration: number;
    memoryPeak: number;
    cpuUsage: number;
    frameDrops: number;
  };
}

export interface PerfettoTable {
  name: string;
  description: string;
  columns: {
    name: string;
    type: string;
    description: string;
  }[];
}

export interface ErrorResponse {
  error: string;
  details?: string;
}