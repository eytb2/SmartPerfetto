import express from 'express';

export interface LegacyRouteDeprecationOptions {
  legacyBasePath: string;
  replacementMethod: 'POST' | 'GET';
  replacementPath: string;
  migrationHint?: string;
}

export function createLegacyRouteDeprecationRouter(
  options: LegacyRouteDeprecationOptions
): express.Router {
  const router = express.Router();
  const migrationHint =
    options.migrationHint ||
    `Use ${options.replacementMethod} ${options.replacementPath} instead.`;

  router.use((req, res) => {
    return res.status(410).json({
      success: false,
      code: 'LEGACY_ROUTE_DEPRECATED',
      error: `${options.legacyBasePath} is deprecated`,
      hint: migrationHint,
      legacy: {
        basePath: options.legacyBasePath,
        method: req.method,
        requestedPath: req.originalUrl,
      },
      replacement: {
        method: options.replacementMethod,
        path: options.replacementPath,
      },
    });
  });

  return router;
}
