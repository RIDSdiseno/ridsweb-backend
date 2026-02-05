// src/app.ts
import "dotenv/config"; // Carga las variables de entorno desde .env

import express, { Application } from "express";
import cors from "cors";
import apiRouter from "./api.routes";
import iaRoutes from "./routes/ia.routes";

const app: Application = express();

// 🔎 Logs útiles para depurar entorno (sin mostrar la API key completa)
console.log("=== ENV CHECK ===");
console.log("[ENV] NODE_ENV:", process.env.NODE_ENV || "dev");
console.log(
  "[ENV] OPENAI_API_KEY presente?:",
  process.env.OPENAI_API_KEY ? "SÍ" : "NO"
);
console.log(
  "[ENV] PA_TICKET_URL configurada?:",
  process.env.PA_TICKET_URL ? "SÍ" : "NO"
);
console.log(
  "[ENV] FRONTEND_ORIGIN:",
  process.env.FRONTEND_ORIGIN || "(no definido)"
);
console.log("=== END ENV CHECK ===");

// Orígenes por defecto (local + producción)
const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://rids.cl",
  "https://www.rids.cl",
];

// Origen extra opcional por env (por ejemplo: otro dominio)
const extraOrigin = process.env.FRONTEND_ORIGIN; // ej: https://otro-dominio.cl
const allowedOrigins = extraOrigin
  ? [...defaultOrigins, extraOrigin]
  : defaultOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Permitir requests sin origin (Postman, curl, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("[CORS] Origin no permitido:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json());

// Rutas principales
app.use("/api", apiRouter);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`RIDS backend (TS) escuchando en http://localhost:${PORT}`);
  console.log("CORS allowed origins:", allowedOrigins);
});

// ... otros middlewares
app.use("/api/ia", iaRoutes);