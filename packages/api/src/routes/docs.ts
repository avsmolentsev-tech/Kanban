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

// GET /v1/docs — Swagger UI. Бандл и стили подключаются с CDN (unpkg.com),
// без добавления зависимости в проект; для интегратора в сети с
// ограниченным доступом наружу это единственная точка отказа страницы —
// если unpkg.com недоступен, ниже показывается понятный фолбэк вместо
// пустого экрана.
docsRouter.get('/docs', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Clarity Space API — документация</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #docs-fallback {
      display: none;
      max-width: 640px;
      margin: 48px auto;
      padding: 0 24px;
      line-height: 1.6;
    }
    #docs-fallback code {
      background: #f1f1f1;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>

  <!-- Показывается вручную скриптом ниже, если бандл со Swagger UI не
       загрузился (например, unpkg.com заблокирован сетью). -->
  <div id="docs-fallback">
    <h1>Интерфейс документации не загрузился</h1>
    <p>
      Swagger UI подключается с внешнего CDN (unpkg.com) — похоже, он
      недоступен в вашей сети.
    </p>
    <p>
      Сама спецификация OpenAPI 3.1 всегда доступна по адресу
      <code>/v1/openapi.yaml</code> и открывается в любом
      OpenAPI-инструменте (Postman, Insomnia, VS Code с расширением OpenAPI,
      редактор <a href="https://editor.swagger.io" target="_blank" rel="noopener">editor.swagger.io</a>
      и т.п.) — достаточно указать этот адрес как источник схемы.
    </p>
  </div>

  <!-- Показывается, если в браузере отключён JavaScript — тогда ни Swagger
       UI, ни скрипт-фолбэк ниже не сработают вовсе. -->
  <noscript>
    <style>#swagger-ui { display: none; }</style>
    <div style="max-width: 640px; margin: 48px auto; padding: 0 24px; line-height: 1.6;">
      <h1>Нужен JavaScript</h1>
      <p>
        Эта страница использует JavaScript для отрисовки Swagger UI.
        Спецификация OpenAPI 3.1 доступна без JavaScript по адресу
        <code>/v1/openapi.yaml</code> и открывается в любом OpenAPI-инструменте.
      </p>
    </div>
  </noscript>

  <script>
    function showDocsFallback() {
      var ui = document.getElementById('swagger-ui');
      var fallback = document.getElementById('docs-fallback');
      if (ui) ui.style.display = 'none';
      if (fallback) fallback.style.display = 'block';
    }
  </script>
  <script
    src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
    crossorigin
    onerror="showDocsFallback()"
  ></script>
  <script>
    if (window.SwaggerUIBundle) {
      window.ui = SwaggerUIBundle({
        url: '/v1/openapi.yaml',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    } else {
      showDocsFallback();
    }
  </script>
</body>
</html>`;
  res.type('text/html').send(html);
});
