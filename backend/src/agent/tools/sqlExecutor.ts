import { Tool, ToolContext, ToolResult, ToolDefinition } from '../types';

interface SQLExecutorParams {
  sql: string;
}

interface SQLExecutorResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
}

const definition: ToolDefinition = {
  name: 'execute_sql',
  description: 'Execute a Perfetto SQL query against the loaded trace. Returns query results as columns and rows.',
  category: 'sql',
  parameters: [
    {
      name: 'sql',
      type: 'string',
      required: true,
      description: 'The SQL query to execute. Must be valid Perfetto SQL syntax.',
    },
  ],
  returns: {
    type: 'SQLExecutorResult',
    description: 'Query results with columns array and rows array of arrays',
  },
};

export const sqlExecutorTool: Tool<SQLExecutorParams, SQLExecutorResult> = {
  definition,

  validate(params: SQLExecutorParams) {
    const errors: string[] = [];
    if (!params.sql || typeof params.sql !== 'string') {
      errors.push('sql parameter is required and must be a string');
    }
    if (params.sql && params.sql.trim().length === 0) {
      errors.push('sql parameter cannot be empty');
    }
    return { valid: errors.length === 0, errors };
  },

  async execute(params: SQLExecutorParams, context: ToolContext): Promise<ToolResult<SQLExecutorResult>> {
    const startTime = Date.now();
    
    try {
      const validation = this.validate?.(params);
      if (validation && !validation.valid) {
        return {
          success: false,
          error: validation.errors.join('; '),
          executionTimeMs: Date.now() - startTime,
        };
      }

      let result;
      
      if (context.traceProcessorService && context.traceId) {
        result = await context.traceProcessorService.query(context.traceId, params.sql);
      } else if (context.traceProcessor) {
        result = await context.traceProcessor.query(params.sql);
      } else {
        return {
          success: false,
          error: 'TraceProcessor or TraceProcessorService not available in context',
          executionTimeMs: Date.now() - startTime,
        };
      }
      
      return {
        success: true,
        data: {
          columns: result.columns || [],
          rows: result.rows || [],
          rowCount: result.rows?.length || 0,
        },
        executionTimeMs: Date.now() - startTime,
        metadata: {
          sqlLength: params.sql.length,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'SQL execution failed',
        executionTimeMs: Date.now() - startTime,
      };
    }
  },
};
