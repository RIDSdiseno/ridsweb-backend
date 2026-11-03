// src/analizador/reporte.ts
//
// Reporte periódico de los análisis realizados, enviado por correo (sin base de datos).
//
// - Cada análisis se anota en una lista en memoria.
// - A la hora programada se envía un correo con el resumen, una tabla y un CSV para Excel,
//   y la lista se vacía.
// - Si existe ANALIZADOR_DATA_DIR (un Volume de Railway), la lista también se respalda en un
//   archivo pequeño para no perder lo pendiente si el servidor se reinicia.
// - Al apagarse (deploy de Railway) se intenta enviar lo pendiente como "reporte parcial".
//
// Variables (todas opcionales):
//   ANALIZADOR_REPORTE=0                 desactiva el reporte
//   ANALIZADOR_REPORTE_HORA=08:00        hora diaria de envío (hora de Chile)
//   ANALIZADOR_REPORTE_CADA_HORAS=6      en vez de diario, cada N horas
//   ANALIZADOR_REPORTE_EMAIL=...         destinatario (por omisión ANALIZADOR_AVISO_EMAIL o CONTACT_EMAIL)
//   ANALIZADOR_REPORTE_VACIO=1           enviar el reporte aunque no haya análisis

import fs from "node:fs";
import path from "node:path";
import { enviarCorreo, correoRids } from "../utils/correo";

export interface RegistroAnalisis {
  fecha: string; // ISO
  dominio: string;
  puntaje: number | null;
  nivel: string | null;
  nombre: string;
  email: string;
  empresa: string;
  telefono: string;
  novedades: boolean;
  correo: string; // enviado | error | -
  error?: string; // si el análisis falló
}

const ZONA = "America/Santiago";
const MAX_PENDIENTES = 5000;

let pendientes: RegistroAnalisis[] = [];
let ultimoEnvio = Date.now();
let ultimoDia = ""; // AAAA-MM-DD del último reporte diario
let enviando = false;
let timer: NodeJS.Timeout | null = null;

// ------------------------------------------------------------
// Configuración
// ------------------------------------------------------------

const activo = () => process.env.ANALIZADOR_REPORTE !== "0";
const destinatario = () =>
  process.env.ANALIZADOR_REPORTE_EMAIL || process.env.ANALIZADOR_AVISO_EMAIL || correoRids();
const cadaHoras = () => Number(process.env.ANALIZADOR_REPORTE_CADA_HORAS) || 0;
const horaDiaria = () => {
  const m = (process.env.ANALIZADOR_REPORTE_HORA || "08:00").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
};
const enviarVacio = () => process.env.ANALIZADOR_REPORTE_VACIO === "1";

// ------------------------------------------------------------
// Respaldo en archivo (solo si hay volumen)
// ------------------------------------------------------------

const archivo = () =>
  process.env.ANALIZADOR_DATA_DIR ? path.join(process.env.ANALIZADOR_DATA_DIR, "reporte-pendiente.json") : null;

function guardar() {
  const f = archivo();
  if (!f) return;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ pendientes, ultimoEnvio, ultimoDia }));
  } catch (e) {
    console.error("[REPORTE] No se pudo respaldar:", (e as Error).message);
  }
}

function cargar() {
  const f = archivo();
  if (!f || !fs.existsSync(f)) return;
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    if (Array.isArray(d.pendientes)) pendientes = d.pendientes.slice(-MAX_PENDIENTES);
    if (typeof d.ultimoEnvio === "number") ultimoEnvio = d.ultimoEnvio;
    if (typeof d.ultimoDia === "string") ultimoDia = d.ultimoDia;
  } catch (e) {
    console.error("[REPORTE] Respaldo ilegible, se ignora:", (e as Error).message);
  }
}

// ------------------------------------------------------------
// Registro
// ------------------------------------------------------------

export function registrarAnalisis(r: RegistroAnalisis) {
  if (!activo()) return;
  pendientes.push(r);
  if (pendientes.length > MAX_PENDIENTES) pendientes = pendientes.slice(-MAX_PENDIENTES);
  guardar();
}

// ------------------------------------------------------------
// Fechas en hora de Chile
// ------------------------------------------------------------

function partesChile(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  const hora = Number(p.hour) % 24;
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: hora * 60 + Number(p.minute) };
}

const fechaChile = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));

const diaLargo = (d = new Date()) =>
  new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, day: "2-digit", month: "long", year: "numeric" }).format(d);

// ------------------------------------------------------------
// Contenido del reporte
// ------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Celda CSV segura: comillas escapadas y sin fórmulas (=, +, -, @) que Excel ejecutaría. */
const celda = (v: unknown) => {
  let s = String(v ?? "");
  if (/^\+[\d\s()-]+$/.test(s)) s = "\u00A0" + s; // teléfonos: texto, sin apóstrofo visible
  else if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // posibles fórmulas
  return `"${s.replace(/"/g, '""')}"`;
};

function generarCsv(lista: RegistroAnalisis[]): string {
  const cab = ["Fecha (Chile)", "Dominio", "Puntaje", "Nivel", "Nombre", "Empresa", "Correo", "Teléfono", "Acepta novedades", "Informe enviado", "Error"];
  const filas = lista.map((r) =>
    [
      fechaChile(r.fecha), r.dominio, r.puntaje ?? "", r.nivel ?? "", r.nombre, r.empresa, r.email, r.telefono,
      r.novedades ? "Sí" : "No", r.correo === "-" ? "" : r.correo, r.error ?? "",
    ].map(celda).join(";")
  );
  // BOM + punto y coma: Excel en español lo abre con acentos y columnas correctas
  return "﻿" + [cab.map(celda).join(";"), ...filas].join("\r\n");
}

function generarHtml(lista: RegistroAnalisis[], titulo: string, desde: number): string {
  const ok = lista.filter((r) => r.puntaje !== null);
  const promedio = ok.length ? Math.round(ok.reduce((s, r) => s + (r.puntaje as number), 0) / ok.length) : 0;
  const criticos = ok.filter((r) => (r.puntaje as number) < 55);
  const mejorables = ok.filter((r) => (r.puntaje as number) >= 55 && (r.puntaje as number) < 80);
  const buenos = ok.filter((r) => (r.puntaje as number) >= 80);
  const fallidos = lista.filter((r) => r.puntaje === null);
  const dominios = new Set(lista.map((r) => r.dominio)).size;

  const color = (p: number | null) => (p === null ? "#6b7c8f" : p >= 80 ? "#1f8a5b" : p >= 55 ? "#c98a0b" : "#c0392b");
  const caja = (n: number | string, t: string, c = "#074763") =>
    `<td style="padding:12px;text-align:center;background:#f7fafd;border-radius:8px">
      <div style="font-size:24px;font-weight:700;color:${c}">${n}</div><div style="font-size:12px;color:#5b6b7b">${t}</div></td>`;

  const filas = lista
    .slice()
    .sort((a, b) => (a.puntaje ?? 999) - (b.puntaje ?? 999)) // los de menor puntaje primero: mayor oportunidad
    .map((r) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee;white-space:nowrap">${esc(fechaChile(r.fecha))}</td>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee"><a href="https://${esc(r.dominio)}" style="color:#074763">${esc(r.dominio)}</a></td>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee;font-weight:700;color:${color(r.puntaje)}">${r.puntaje ?? "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee">${esc(r.nombre)}${r.empresa ? `<br><span style="color:#5b6b7b">${esc(r.empresa)}</span>` : ""}</td>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee"><a href="mailto:${esc(r.email)}" style="color:#074763">${esc(r.email)}</a>${r.telefono ? `<br>${esc(r.telefono)}` : ""}</td>
      <td style="padding:8px;border-bottom:1px solid #dfe6ee">${r.novedades ? "Sí" : "No"}</td>
    </tr>`)
    .join("");

  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7fafd;font-family:Segoe UI,Arial,sans-serif;color:#1d2733">
<div style="max-width:900px;margin:0 auto;padding:24px 12px">
<div style="background:#074763;color:#fff;border-radius:10px 10px 0 0;padding:22px 26px">
  <div style="font-size:20px;font-weight:700">${esc(titulo)}</div>
  <div style="font-size:13px;color:#cfe6f3;margin-top:4px">Desde ${esc(fechaChile(new Date(desde).toISOString()))} hasta ${esc(fechaChile(new Date().toISOString()))} (hora de Chile)</div>
</div>
<div style="background:#fff;border:1px solid #dfe6ee;border-top:0;border-radius:0 0 10px 10px;padding:22px 26px">
  <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>
    ${caja(lista.length, "análisis")}${caja(dominios, "dominios distintos")}${caja(ok.length ? promedio : "—", "puntaje promedio")}
    ${caja(criticos.length, "críticos (&lt;55)", "#c0392b")}${caja(mejorables.length, "mejorables", "#c98a0b")}${caja(buenos.length, "buenos (80+)", "#1f8a5b")}
  </tr></table>
  ${fallidos.length ? `<p style="font-size:13px;color:#5b6b7b">${fallidos.length === 1 ? "1 análisis no se completó" : `${fallidos.length} análisis no se completaron`} (sitio caído o dominio inválido).</p>` : ""}
  ${lista.length ? `
  <p style="font-size:13px;color:#5b6b7b;margin:18px 0 8px">Ordenados de menor a mayor puntaje (los primeros son los que más ayuda necesitan). El detalle completo va en el CSV adjunto.</p>
  <table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse">
    <tr style="background:#f7fafd;text-align:left">
      <th style="padding:8px">Fecha</th><th style="padding:8px">Sitio</th><th style="padding:8px">Puntaje</th>
      <th style="padding:8px">Contacto</th><th style="padding:8px">Correo / teléfono</th><th style="padding:8px">Novedades</th>
    </tr>${filas}
  </table>` : `<p style="font-size:14px">No hubo análisis en este período.</p>`}
  <p style="font-size:11px;color:#9aa7b4;margin-top:22px">Contiene datos personales de quienes solicitaron el informe: uso interno de RIDS, solo para la finalidad aceptada en el formulario.</p>
</div></div></body></html>`;
}

// ------------------------------------------------------------
// Envío
// ------------------------------------------------------------

export async function enviarReporte(motivo: "programado" | "manual" | "reinicio" = "programado"): Promise<number> {
  if (!activo() || enviando) return 0;
  const lista = pendientes.slice();
  if (!lista.length && !enviarVacio()) {
    ultimoEnvio = Date.now();
    guardar();
    return 0;
  }

  enviando = true;
  const desde = ultimoEnvio;
  const titulo =
    motivo === "reinicio"
      ? "Reporte parcial del analizador Ley 21.719 (reinicio del servidor)"
      : `Reporte del analizador Ley 21.719 — ${diaLargo()}`;

  try {
    await enviarCorreo({
      para: destinatario(),
      asunto: `${titulo}: ${lista.length} análisis`,
      html: generarHtml(lista, titulo, desde),
      texto: `${titulo}\n${lista.length} análisis. El detalle va en el CSV adjunto.`,
      adjuntos: lista.length
        ? [{
            filename: `analizador-ley-21719-${partesChile().dia}.csv`,
            content: Buffer.from(generarCsv(lista), "utf8"),
            contentType: "text/csv",
          }]
        : [],
    });
    // Se quitan solo los registros enviados (pudieron llegar otros mientras se enviaba)
    pendientes = pendientes.slice(lista.length);
    ultimoEnvio = Date.now();
    guardar();
    console.log("[REPORTE] Enviado", { motivo, analisis: lista.length });
    return lista.length;
  } catch (e) {
    console.error("[REPORTE] No se pudo enviar; se reintentará en el próximo ciclo:", (e as Error).message);
    return 0;
  } finally {
    enviando = false;
  }
}

/** Revisa cada minuto si corresponde enviar. */
function revisar() {
  const h = cadaHoras();
  if (h > 0) {
    if (Date.now() - ultimoEnvio >= h * 3600_000) void enviarReporte();
    return;
  }
  const { dia, minutos } = partesChile();
  if (dia !== ultimoDia && minutos >= horaDiaria()) {
    ultimoDia = dia;
    guardar();
    void enviarReporte();
  }
}

export function iniciarReportes() {
  if (!activo() || timer) return;
  cargar();

  // Si el servidor arranca después de la hora del reporte, no se reenvía el de hoy
  const { dia, minutos } = partesChile();
  if (!ultimoDia && minutos >= horaDiaria()) ultimoDia = dia;

  timer = setInterval(revisar, 60_000);
  timer.unref();
  console.log(
    "[REPORTE] Programado",
    cadaHoras() > 0 ? `cada ${cadaHoras()} h` : `diario a las ${process.env.ANALIZADOR_REPORTE_HORA || "08:00"} (Chile)`,
    `→ ${destinatario()}`
  );
}

/** Al apagar (deploy): envía lo pendiente para no perderlo, con un tope de 8 segundos. */
export async function enviarPendientesAlApagar() {
  if (!activo() || !pendientes.length || archivo()) return; // con volumen, queda respaldado en disco
  await Promise.race([enviarReporte("reinicio"), new Promise((ok) => setTimeout(ok, 8000))]);
}

export const cantidadPendiente = () => pendientes.length;