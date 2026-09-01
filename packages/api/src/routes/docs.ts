import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

export const docsRouter = Router();

// Спека лежит рядом с исходниками при разработке (src/openapi/openapi.yaml) и
// копируется build.mjs в dist/openapi/openapi.yaml для продакшн-сборки — путь
// один и тот же относительно скомпилированного docs.js/docs.ts.
const SPEC_PATH = path.resolve(__dirname, '../openapi/openapi.yaml');

// GET /v1/openapi.yaml — текст спецификации OpenAPI 3.1
docsRouter.get('/openapi.yaml', (_req: Request, res: Response) => {
  try {
    const text = fs.readFileSync(SPEC_PATH, 'utf8');
    res.type('text/yaml').send(text);
  } catch {
    res.status(500).json({ success: false, error: 'Спецификация недоступна' });
  }
});

// GET /v1/docs — Swagger UI (CDN-бандл, без добавления зависимости в проект),
// читает спеку с /v1/openapi.yaml относительным путём.
docsRouter.get('/docs', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Clarity Space API — документация</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/v1/openapi.yaml',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
  res.type('text/html').send(html);
});
