// src/analizador/informe.ts
// Informe del análisis: PDF adjunto y versión HTML / texto para el cuerpo del correo.

import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import type { Control, Estado, Resultado } from "./analisis";

// El logo vive en <raíz del backend>/assets (fuera de src: tsc no copia imágenes a dist)
const LOGO = path.resolve(process.cwd(), "assets", "logo-rids-blanco.png");
export const RUTA_LOGO: string | null = fs.existsSync(LOGO) ? LOGO : null;
if (!RUTA_LOGO) console.warn(`[analizador] No se encontró el logo en ${LOGO}; el informe saldrá sin logo.`);

export interface ContactoInforme {
  nombre: string;
  empresa?: string;
}

export interface ConfigInforme {
  correoContacto?: string;
  telefono?: string;
  urlAgenda?: string;
  urlPrivacidad?: string;
}

const AZUL = "#074763";
const CELESTE = "#00aeef";
const TINTA = "#1d2733";
const GRIS = "#5b6b7b";
const LINEA = "#dfe6ee";
const FONDO = "#f7fafd";

export const ESTADOS: Record<Estado, { txt: string; color: string }> = {
  ok: { txt: "Cumple", color: "#1f8a5b" },
  parcial: { txt: "Parcial", color: "#c98a0b" },
  falla: { txt: "No cumple", color: "#c0392b" },
  revisar: { txt: "Revisar", color: "#6b7c8f" },
  na: { txt: "No aplica", color: "#9aa7b4" },
};

const colorNivel = (p: number) => (p >= 80 ? "#1f8a5b" : p >= 55 ? "#c98a0b" : "#c0392b");

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Santiago",
  });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function prioridades(r: Resultado, n = 5): Control[] {
  const orden: Partial<Record<Estado, number>> = { falla: 0, parcial: 1, revisar: 2 };
  return r.controles
    .filter((c) => c.recomendacion && c.estado in orden)
    .sort((a, b) => (orden[a.estado] as number) - (orden[b.estado] as number) || b.peso - a.peso)
    .slice(0, n);
}

// ============================================================
// PDF
// ============================================================

export function generarPdf(r: Resultado, contacto: ContactoInforme, cfg: ConfigInforme = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 60, left: 54, right: 54 },
      bufferPages: true,
      info: { Title: `Informe Ley 21.719 — ${r.dominio}`, Author: "RIDS", Subject: "Revisión pública del sitio web" },
    });

    const partes: Buffer[] = [];
    doc.on("data", (d: Buffer) => partes.push(d));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    const W = doc.page.width - 108;
    const X = 54;

    const titulo = (t: string) => {
      saltoSiFalta(50);
      doc.fill(AZUL).font("Helvetica-Bold").fontSize(13).text(t, 54, doc.y);
      doc.moveTo(54, doc.y + 3).lineTo(94, doc.y + 3).lineWidth(2).stroke(CELESTE);
      doc.moveDown(0.8);
    };

    const saltoSiFalta = (alto: number) => {
      if (doc.y + alto > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };

    // Encabezado
    doc.rect(0, 0, doc.page.width, 150).fill(AZUL);
    if (RUTA_LOGO) {
      try {
        doc.image(RUTA_LOGO, X, 30, { height: 46 });
      } catch {
        doc.fill("#fff").fontSize(22).text("RIDS", X, 40);
      }
    } else {
      doc.fill("#fff").font("Helvetica-Bold").fontSize(22).text("RIDS", X, 40);
    }
    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(18).text("Informe de cumplimiento Ley 21.719", X, 92, { width: W });
    doc.font("Helvetica").fontSize(10).fill("#cfe6f3").text(`Sitio revisado: ${r.dominio}   ·   ${fecha(r.fecha)}`, X, 117);
    doc.y = 176;

    // Puntaje
    const yP = doc.y;
    doc.roundedRect(X, yP, W, 92, 6).fill(FONDO);
    doc.fill(colorNivel(r.puntaje)).font("Helvetica-Bold").fontSize(40)
      .text(String(r.puntaje), X + 20, yP + 18, { width: 90, align: "center" });
    doc.fill(GRIS).font("Helvetica").fontSize(9).text("de 100", X + 20, yP + 64, { width: 90, align: "center" });
    doc.fill(TINTA).font("Helvetica-Bold").fontSize(13).text(`Nivel: ${r.nivel}`, X + 130, yP + 20);
    doc.font("Helvetica").fontSize(9.5).fill(GRIS).text(
      `Preparado para ${contacto.nombre}${contacto.empresa ? `, ${contacto.empresa}` : ""}. ` +
        `Revisión automática de lo que cualquier visitante ve del sitio ${r.sitio.url}. ` +
        "La Ley 21.719 rige desde el 1 de diciembre de 2026.",
      X + 130, yP + 40, { width: W - 150 }
    );
    doc.y = yP + 112;

    // Resumen por área
    titulo("Resumen por área");
    for (const c of r.categorias) {
      const y = doc.y;
      const e = ESTADOS[c.estado];
      doc.circle(X + 5, y + 5, 4).fill(e.color);
      doc.fill(TINTA).font("Helvetica").fontSize(10).text(c.nombre, X + 16, y, { width: 260 });
      doc.fill(GRIS).fontSize(9).text(
        c.fallas
          ? `${c.fallas} incumplimiento(s)${c.parciales ? `, ${c.parciales} por mejorar` : ""}`
          : c.parciales
            ? `${c.parciales} por mejorar`
            : "Sin observaciones",
        X + 280, y, { width: W - 280, align: "right" }
      );
      doc.y = y + 18;
    }
    doc.moveDown(0.8);

    // Prioridades
    const pr = prioridades(r);
    if (pr.length) {
      titulo("Qué corregir primero");
      pr.forEach((c, i) => {
        saltoSiFalta(46);
        const y = doc.y;
        doc.fill(CELESTE).font("Helvetica-Bold").fontSize(10).text(`${i + 1}.`, X, y, { width: 16 });
        doc.fill(TINTA).text(c.titulo, X + 18, y, { width: W - 18 });
        doc.fill(GRIS).font("Helvetica").fontSize(9.5).text(c.recomendacion || "", X + 18, doc.y + 1, { width: W - 18 });
        doc.moveDown(0.6);
      });
      doc.moveDown(0.4);
    }

    // Detalle
    titulo("Detalle de la revisión");
    for (const cat of r.categorias) {
      saltoSiFalta(60);
      doc.fill(AZUL).font("Helvetica-Bold").fontSize(11).text(cat.nombre, X, doc.y);
      doc.moveDown(0.3);
      for (const c of r.controles.filter((x) => x.categoria === cat.nombre)) {
        saltoSiFalta(54);
        const y = doc.y;
        const e = ESTADOS[c.estado];
        doc.roundedRect(X, y, 62, 15, 3).fill(e.color);
        doc.fill("#fff").font("Helvetica-Bold").fontSize(7.5).text(e.txt.toUpperCase(), X, y + 4.5, { width: 62, align: "center" });
        doc.fill(TINTA).font("Helvetica-Bold").fontSize(10).text(c.titulo, X + 72, y + 2, { width: W - 150 });
        doc.fill(GRIS).font("Helvetica").fontSize(8).text(c.ley, X + W - 76, y + 3, { width: 76, align: "right" });
        doc.fill(TINTA).font("Helvetica").fontSize(9).text(c.detalle, X + 72, doc.y + 2, { width: W - 72 });
        if (c.faltan?.length) {
          doc.fill(GRIS).fontSize(8.5).text("Falta: " + c.faltan.join("; ") + ".", X + 72, doc.y + 2, { width: W - 72 });
        }
        if (c.recomendacion) {
          doc.fill(AZUL).fontSize(9).text("Recomendación: " + c.recomendacion, X + 72, doc.y + 2, { width: W - 72 });
        }
        doc.y += 9;
        doc.moveTo(X + 72, doc.y - 4).lineTo(X + W, doc.y - 4).lineWidth(0.5).stroke(LINEA);
      }
      doc.moveDown(0.6);
    }

    if (r.datos.servicios.length) {
      saltoSiFalta(80);
      titulo("Servicios de terceros detectados");
      for (const s of r.datos.servicios) {
        doc.fill(TINTA).font("Helvetica").fontSize(9)
          .text(`•  ${s.nombre} — ${s.tipo}${s.cookies ? " (instala cookies)" : ""}`, X, doc.y, { width: W });
      }
      doc.moveDown(0.8);
    }

    // Alcance y contacto
    saltoSiFalta(170);
    titulo("Alcance de esta revisión");
    doc.fill(GRIS).font("Helvetica").fontSize(8.8).text(
      "Este informe revisa en forma automática la página de inicio, la política de privacidad enlazada y la configuración pública del dominio. " +
        "No revisa sistemas internos, bases de datos, contratos con proveedores, registro de actividades de tratamiento, protocolos de vulneraciones " +
        "ni otras obligaciones de la Ley 21.719 que no son visibles desde internet. No constituye asesoría legal.",
      X, doc.y, { width: W, align: "justify" }
    );
    doc.moveDown(1);
    const yC = doc.y;
    doc.roundedRect(X, yC, W, 70, 6).fill(AZUL);
    doc.fill("#fff").font("Helvetica-Bold").fontSize(12)
      .text("¿Le ayudamos a cumplir antes del 1 de diciembre de 2026?", X + 18, yC + 14, { width: W - 36 });
    doc.font("Helvetica").fontSize(9.5).fill("#cfe6f3").text(
      `RIDS implementa la política, el banner de cookies, los formularios y las medidas de seguridad. Escríbanos a ${cfg.correoContacto || "soporte@rids.cl"}${cfg.telefono ? ` o al ${cfg.telefono}` : ""}.`,
      X + 18, yC + 34, { width: W - 36 }
    );

    // Pie en todas las páginas
    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) {
      doc.switchToPage(i);
      const fondo = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fill("#9aa7b4").font("Helvetica").fontSize(7.5)
        .text(`RIDS · rids.cl · Informe ${r.dominio} · Página ${i + 1} de ${n}`, X, doc.page.height - 36, { width: W, align: "center" });
      doc.page.margins.bottom = fondo;
    }
    doc.end();
  });
}

// ============================================================
// CORREO (HTML y texto)
// ============================================================

export function generarHtmlCorreo(r: Resultado, contacto: ContactoInforme, cfg: ConfigInforme = {}): string {
  const pr = prioridades(r);

  const filaCat = r.categorias.map((c) => {
    const e = ESTADOS[c.estado];
    return `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINEA};font-size:14px;color:${TINTA}">
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${e.color};margin-right:8px"></span>${esc(c.nombre)}</td>
      <td style="padding:8px 0;border-bottom:1px solid ${LINEA};font-size:13px;color:${e.color};text-align:right;font-weight:600">${e.txt}</td></tr>`;
  }).join("");

  const filaPr = pr.map((c, i) => `<tr><td style="padding:0 0 14px;vertical-align:top;width:22px;color:${CELESTE};font-weight:700;font-size:14px">${i + 1}.</td>
    <td style="padding:0 0 14px;font-size:14px;color:${TINTA}"><strong>${esc(c.titulo)}</strong><br>
    <span style="color:${GRIS};font-size:13px;line-height:1.5">${esc(c.recomendacion)}</span></td></tr>`).join("");

  // Con logo: imagen incrustada (cid). Sin logo: texto.
  const cabecera = RUTA_LOGO
    ? `<img src="cid:logo-rids" alt="RIDS" height="40" style="display:block;height:40px;border:0">`
    : `<div style="color:#fff;font-size:24px;font-weight:700">RIDS</div>`;

  return `<!doctype html><html lang="es"><body style="margin:0;background:${FONDO};font-family:Poppins,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;border:1px solid ${LINEA}">
<tr><td style="background:${AZUL};padding:26px 32px">
  ${cabecera}
  <div style="color:#fff;font-size:20px;font-weight:700;margin-top:18px">Informe Ley 21.719</div>
  <div style="color:#cfe6f3;font-size:13px;margin-top:4px">${esc(r.dominio)} · ${fecha(r.fecha)}</div></td></tr>
<tr><td style="padding:28px 32px 8px">
  <p style="margin:0 0 18px;font-size:15px;color:${TINTA}">Hola ${esc(contacto.nombre.split(" ")[0])}, aquí está el resultado de la revisión de <strong>${esc(r.dominio)}</strong>. El informe completo va adjunto en PDF.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};border-radius:8px"><tr>
    <td style="padding:18px 22px;width:110px;text-align:center"><div style="font-size:42px;font-weight:700;color:${colorNivel(r.puntaje)};line-height:1">${r.puntaje}</div><div style="font-size:12px;color:${GRIS}">de 100</div></td>
    <td style="padding:18px 22px 18px 0;font-size:14px;color:${TINTA}"><strong>Nivel: ${r.nivel}</strong><br><span style="color:${GRIS};font-size:13px">La Ley 21.719 rige desde el 1 de diciembre de 2026.</span></td></tr></table>
</td></tr>
<tr><td style="padding:18px 32px 4px"><div style="font-size:15px;font-weight:700;color:${AZUL};margin-bottom:6px">Resumen por área</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filaCat}</table></td></tr>
${pr.length ? `<tr><td style="padding:22px 32px 4px"><div style="font-size:15px;font-weight:700;color:${AZUL};margin-bottom:12px">Qué corregir primero</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filaPr}</table></td></tr>` : ""}
<tr><td style="padding:12px 32px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${AZUL};border-radius:8px"><tr><td style="padding:20px 22px">
  <div style="color:#fff;font-size:15px;font-weight:700">¿Le ayudamos a cumplir?</div>
  <div style="color:#cfe6f3;font-size:13px;margin:6px 0 14px;line-height:1.5">Implementamos la política, el banner de cookies, los formularios y las medidas de seguridad que exige la ley.</div>
  <a href="${esc(cfg.urlAgenda || "https://rids.cl/#contacto")}" style="display:inline-block;background:${CELESTE};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:6px">Hablar con RIDS</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px 26px;font-size:11px;color:#9aa7b4;line-height:1.5">Revisión automática de la información pública del sitio; no constituye asesoría legal.
Recibe este correo porque solicitó el informe en rids.cl. Sus datos se tratan según nuestra <a href="${esc(cfg.urlPrivacidad || "https://rids.cl/politica-privacidad")}" style="color:#9aa7b4">política de privacidad</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

export function textoPlano(r: Resultado, contacto: ContactoInforme): string {
  return [
    `Hola ${contacto.nombre},`,
    "",
    `Resultado de la revisión de ${r.dominio}: ${r.puntaje}/100 (${r.nivel}).`,
    "",
    ...r.categorias.map((c) => `- ${c.nombre}: ${ESTADOS[c.estado].txt}`),
    "",
    "Qué corregir primero:",
    ...prioridades(r).map((c, i) => `${i + 1}. ${c.titulo}: ${c.recomendacion}`),
    "",
    "El informe completo va adjunto en PDF.",
    "",
    "RIDS — rids.cl",
  ].join("\n");
}
