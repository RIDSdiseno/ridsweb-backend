// src/app.ts

import "dotenv/config";

import express, {
  Application,
} from "express";

import cors from "cors";
import helmet from "helmet";

import apiRouter from "./api.routes";

const app: Application =
  express();

/* =====================================================
   PROXY
===================================================== */

/**
 * Railway utiliza reverse proxy.
 *
 * Esto permite que Express y express-rate-limit
 * puedan identificar correctamente la IP original
 * del cliente.
 */
app.set(
  "trust proxy",
  1
);

/* =====================================================
   SEGURIDAD HTTP
===================================================== */

app.use(
  helmet()
);

/* =====================================================
   CORS
===================================================== */

const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://rids.cl",
  "https://www.rids.cl",
];

const extraOrigin =
  process.env.FRONTEND_ORIGIN;

const allowedOrigins =
  extraOrigin
    ? [
      ...defaultOrigins,
      extraOrigin,
    ]
    : defaultOrigins;

app.use(
  cors({
    origin(
      origin,
      callback
    ) {
      /**
       * Requests sin Origin:
       *
       * curl
       * Postman
       * health checks
       * requests servidor-servidor
       */
      if (!origin) {
        return callback(
          null,
          true
        );
      }

      if (
        allowedOrigins.includes(
          origin
        )
      ) {
        return callback(
          null,
          true
        );
      }

      console.warn(
        "[CORS] Origen rechazado"
      );

      return callback(
        new Error(
          "Not allowed by CORS"
        )
      );
    },
  })
);

/* =====================================================
   JSON
===================================================== */

/**
 * Contacto y chatbot sólo utilizan
 * payloads pequeños.
 */
app.use(
  express.json({
    limit: "20kb",
  })
);

/* =====================================================
   API
===================================================== */

/**
 * Todas las rutas están centralizadas
 * en api.routes.ts.
 *
 * Resultado:
 *
 * GET  /api/health
 * GET  /api/info
 *
 * POST /api/contact
 *
 * POST /api/ia/chat
 * POST /api/ia/clear
 */
app.use(
  "/api",
  apiRouter
);

/* =====================================================
   SERVIDOR
===================================================== */

const PORT =
  process.env.PORT ||
  4000;

app.listen(
  PORT,
  () => {
    console.log(
      `RIDS backend escuchando en puerto ${PORT}`
    );
  }
);