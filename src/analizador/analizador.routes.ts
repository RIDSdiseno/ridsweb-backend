// src/analizador/analizador.routes.ts
//
// API del analizador Ley 21.719 (montada en /api/analizador desde api.routes.ts)
//
//   POST /api/analizador/analisis      { sitio, nombre, email, empresa?, telefono?, acepta, novedades?, web } -> { id }
//   GET  /api/analizador/analisis/:id  -> { estado, paso, resultado?, correo?, error? }
//   GET  /api/analizador/salud         -> { ok, correo }

import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { analizarSitio, type Resultado } from "./analisis";
import { ErrorUsuario, normalizarDominio } from "./red";
import { generarPdf, generarHtmlCorreo, textoPlano, prioridades, RUTA_LOGO, type ConfigInforme } from "./informe";
import { enviarCorreo, correoConfigurado, correoRids } from "./correo";

import { registrarAnalisis, enviarReporte, cantidadPendiente } from "./reportes";

// ============================================================
// TIPOS
// ============================================================

type Trabajo = {
  estado: "en_curso" | "listo" | "error";
  paso: string;
  creado: number;
  resumen?: ReturnType<typeof resumen>;
  correo?: "enviando" | "enviado" | "error";
  error?: string;
};

type Contacto = {
  nombre: string;
  email: string;
  empresa: string;
  telefono: string;
};

// ============================================================
// CONFIGURACIÓN (se lee al usarse, no al importar)
// ============================================================

const cfg = (): ConfigInforme => ({
  correoContacto: correoRids(),
  telefono: process.env.TELEFONO_CONTACTO || "",
  urlAgenda: process.env.URL_AGENDA || "https://rids.cl/#contacto",
  urlPrivacidad: process.env.URL_PRIVACIDAD || "https://rids.cl/politica-privacidad",
});

const maxSimultaneos = () => Number(process.env.ANALIZADOR_MAX_SIMULTANEOS) || 4;

// ============================================================
// ESTADO EN MEMORIA
// ============================================================
// Los análisis viven en memoria: el backend debe correr en UNA sola instancia
// (Railway por defecto usa una réplica).

const trabajos = new Map<string, Trabajo>();
const cache = new Map<string, { r: Resultado; t: number }>(); // dominio -> resultado (1 hora)
const enCurso = new Set<string>();

setInterval(() => {
  const limite = Date.now() - 60 * 60 * 1000;
  for (const [k, v] of trabajos) if (v.creado < limite) trabajos.delete(k);
  for (const [k, v] of cache) if (v.t < limite) cache.delete(k);
}, 10 * 60 * 1000).unref();

// ============================================================
// UTILIDADES
// ============================================================

const RE_EMAIL = /^[^\s@<>()"',;:]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

const limpiar = (s: unknown, n: number) =>
  String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

const responderError = (res: Response, code: number, error: string): void => {
  res.status(code).json({ error });
};

function resumen(r: Resultado) {
  return {
    dominio: r.dominio,
    puntaje: r.puntaje,
    nivel: r.nivel,
    fecha: r.fecha,
    categorias: r.categorias,
    hallazgos: prioridades(r, 3).map((c) => ({ titulo: c.titulo, estado: c.estado, detalle: c.detalle })),
    totalHallazgos: r.controles.filter((c) => c.estado === "falla" || c.estado === "parcial" || c.estado === "revisar").length,
    navegador: r.sitio.navegador,
  };
}

/**
 * Registro de solicitudes (opcional). Solo se guarda si ANALIZADOR_DATA_DIR está definido,
 * porque el disco de Railway se borra en cada deploy: para conservarlo, monte un Volume
 * y apunte la variable a él (por ejemplo /data). El aviso por correo a RIDS se envía siempre.
 */
function guardarSolicitud(registro: object) {
  const dir = process.env.ANALIZADOR_DATA_DIR;
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFile(path.join(dir, "solicitudes.jsonl"), JSON.stringify(registro) + "\n", (e) => {
      if (e) console.error("[ANALIZADOR] No se pudo guardar la solicitud:", e.message);
    });
  } catch (e) {
    console.error("[ANALIZADOR] No se pudo guardar la solicitud:", (e as Error).message);
  }
}

// ============================================================
// LÍMITES
// ============================================================

const limitePorIp = rateLimit({
  windowMs: 60 * 60 * 1000,                                    // ventana de 1 hora
  max: () => Number(process.env.ANALIZADOR_LIMITE_HORA) || 100, // 100 por IP y hora
  skipFailedRequests: true,                                     // los errores (400, 503…) no cuentan
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Alcanzó el máximo de análisis por hora. Intente más tarde." },
});

const limiteConsulta = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas consultas. Espere un momento." },
});

// ============================================================
// PROCESO EN SEGUNDO PLANO
// ============================================================

async function procesar(
  t: Trabajo,
  id: string,
  dominio: string,
  contacto: Contacto,
  novedades: boolean,
  ip: string | undefined
) {
  enCurso.add(id);
  try {
    let r = cache.get(dominio)?.r;
    if (!r) {
      r = await analizarSitio(dominio, { alAvanzar: (p) => { t.paso = p; } });
      cache.set(dominio, { r, t: Date.now() });
    }

    t.paso = "Preparando su informe";
    const pdf = await generarPdf(r, contacto, cfg());
    t.resumen = resumen(r);
    t.estado = "listo";
    t.correo = "enviando";

    guardarSolicitud({
      fecha: new Date().toISOString(),
      ...contacto,
      dominio,
      puntaje: r.puntaje,
      nivel: r.nivel,
      consentimiento: {
        informe: true,
        novedades,
        texto: process.env.TEXTO_CONSENTIMIENTO_VERSION || "v1",
      },
      ip,
    });

    const adjuntoPdf = {
      filename: `Informe-Ley-21719-${dominio}.pdf`,
      content: pdf,
      contentType: "application/pdf",
    };

    // 1) Informe al cliente
    try {
      await enviarCorreo({
        para: contacto.email,
        asunto: `Informe Ley 21.719 de ${dominio}: ${r.puntaje}/100`,
        html: generarHtmlCorreo(r, contacto, cfg()),
        texto: textoPlano(r, contacto),
        adjuntos: RUTA_LOGO
          ? [adjuntoPdf, { filename: "logo-rids.png", path: RUTA_LOGO, cid: "logo-rids" }]
          : [adjuntoPdf],
      });
      t.correo = "enviado";
    } catch (e) {
      t.correo = "error";
      console.error("[ANALIZADOR] Error enviando informe al cliente:", (e as Error).message);
    }

    // Se anota para el reporte periódico
    registrarAnalisis({
      fecha: new Date().toISOString(),
      dominio,
      puntaje: r.puntaje,
      nivel: r.nivel,
      ...contacto,
      novedades,
      correo: t.correo,
    });

    // 2) Aviso interno a RIDS (lead). Se envía siempre: es el registro que no se pierde con los deploys.
    enviarCorreo({
      para: process.env.ANALIZADOR_AVISO_EMAIL || correoRids(),
      asunto: `[Analizador Ley 21.719] ${dominio} (${r.puntaje}/100) — ${contacto.empresa || contacto.nombre}`,
      texto: [
        `Nombre: ${contacto.nombre}`,
        `Correo: ${contacto.email}`,
        `Empresa: ${contacto.empresa || "-"}`,
        `Teléfono: ${contacto.telefono || "-"}`,
        `Sitio: ${dominio}`,
        `Puntaje: ${r.puntaje}/100 (${r.nivel})`,
        `Acepta novedades: ${novedades ? "sí" : "no"}`,
        `Correo al cliente: ${t.correo}`,
        `Fecha (UTC): ${new Date().toISOString()}`,
        "",
        "Principales hallazgos:",
        ...prioridades(r).map((c, i) => `${i + 1}. ${c.titulo}: ${c.detalle}`),
      ].join("\n"),
      responderA: contacto.email,
      adjuntos: [adjuntoPdf],
    }).catch((e) => console.error("[ANALIZADOR] Error enviando aviso interno:", (e as Error).message));
  } catch (e) {
    const err = e as Error & { usuario?: boolean };
    const deUsuario = err.usuario || err instanceof ErrorUsuario;
    t.estado = "error";
    t.error = deUsuario ? err.message : "No pudimos completar el análisis de este sitio.";
    if (!deUsuario) console.error("[ANALIZADOR] Error analizando", dominio, err);

    // También se anotan los análisis fallidos: el contacto igual dejó sus datos
    registrarAnalisis({
      fecha: new Date().toISOString(),
      dominio,
      puntaje: null,
      nivel: null,
      ...contacto,
      novedades,
      correo: "-",
      error: t.error,
    });
    
  } finally {
    enCurso.delete(id);
  }
}

// ============================================================
// RUTAS
// ============================================================

const router = Router();

router.get("/salud", (_req, res) => {
  res.json({ ok: true, correo: correoConfigurado() });
});

router.post("/reporte/enviar", async (req, res) => {
  const esperado = process.env.ADMIN_TOKEN || "";
  const recibido = String(req.headers["x-admin-token"] || "");
  const valido =
    esperado.length >= 16 &&
    recibido.length === esperado.length &&
    crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
  if (!valido) return responderError(res, 404, "No encontrado.");

  const pendientesAntes = cantidadPendiente();
  const enviados = await enviarReporte("manual");
  res.json({ ok: true, pendientesAntes, enviados });
});

router.post("/analisis", limitePorIp, (req, res) => {
  const b = req.body || {};

  // Campo trampa para bots (oculto a las personas): se responde como si nada
  if (b.web) {
    res.status(202).json({ id: crypto.randomUUID() });
    return;
  }

  const contacto: Contacto = {
    nombre: limpiar(b.nombre, 80),
    email: limpiar(b.email, 120).toLowerCase(),
    empresa: limpiar(b.empresa, 120),
    telefono: limpiar(b.telefono, 30),
  };

  if (contacto.nombre.length < 2) return responderError(res, 400, "Escriba su nombre.");
  if (!RE_EMAIL.test(contacto.email)) return responderError(res, 400, "Escriba un correo válido.");
  if (b.acepta !== true) {
    return responderError(res, 400, "Debe aceptar el tratamiento de sus datos para recibir el informe.");
  }
  if (!correoConfigurado()) {
    console.error("[ANALIZADOR] Configuración SMTP incompleta");
    return responderError(res, 503, "El analizador no está disponible temporalmente.");
  }
  if (enCurso.size >= maxSimultaneos()) {
    return responderError(res, 503, "Hay muchos análisis en curso. Intente en un minuto.");
  }

  let dominio: string;
  try {
    dominio = normalizarDominio(b.sitio);
  } catch (e) {
    return responderError(res, 400, e instanceof ErrorUsuario ? e.message : "Dirección no válida.");
  }

  const id = crypto.randomUUID();
  const t: Trabajo = { estado: "en_curso", paso: "Iniciando", creado: Date.now() };
  trabajos.set(id, t);

  // Log seguro: sin datos personales (mismo criterio que contacto)
  console.log("[ANALIZADOR] Análisis solicitado", { dominio, timestamp: new Date().toISOString() });

  res.status(202).json({ id });
  void procesar(t, id, dominio, contacto, b.novedades === true, req.ip);
});

router.get("/analisis/:id", limiteConsulta, (req, res) => {
  const t = trabajos.get(String(req.params.id));
  if (!t) return responderError(res, 404, "El análisis expiró. Vuelva a intentarlo.");
  res.json({ estado: t.estado, paso: t.paso, resultado: t.resumen, correo: t.correo, error: t.error });
});

export default router;
