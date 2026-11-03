// src/analizador/informe.ts
// Informe del análisis: PDF adjunto (estilo de la campaña rids.cl) y versión HTML / texto para el correo.

import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import type { Control, Estado, Resultado } from "./analisis";

// El logo y las fuentes viven en <raíz del backend>/assets (fuera de src: tsc no copia esos archivos a dist)
const ASSETS = path.resolve(process.cwd(), "assets");
const LOGO = path.join(ASSETS, "logo-rids-blanco.png");
export const RUTA_LOGO: string | null = fs.existsSync(LOGO) ? LOGO : null;
if (!RUTA_LOGO) console.warn(`[analizador] No se encontró el logo en ${LOGO}; el informe saldrá sin logo.`);

// Poppins (opcional): assets/fonts/Poppins-Regular.ttf, Poppins-SemiBold.ttf, Poppins-Bold.ttf
const FUENTES = {
  normal: path.join(ASSETS, "fonts", "Poppins-Regular.ttf"),
  semi: path.join(ASSETS, "fonts", "Poppins-SemiBold.ttf"),
  negrita: path.join(ASSETS, "fonts", "Poppins-Bold.ttf"),
};
const HAY_POPPINS = Object.values(FUENTES).every((f) => fs.existsSync(f));

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

// Paleta del correo
const AZUL = "#074763";
const CELESTE = "#00aeef";
const TINTA = "#1d2733";
const GRIS = "#5b6b7b";
const LINEA = "#dfe6ee";
const FONDO = "#f7fafd";

// Paleta del PDF (pieza de campaña)
const P = {
  fondo: "#0b3a54",
  panel: "#0f4664",
  panelActivo: "#11557a",
  borde: "#2a6b8a",
  celeste: "#00aeef",
  blanco: "#ffffff",
  texto: "#e6eef1",
  suave: "#a9c3d1",
  tinta: "#0b2a3c",
  grisTarjeta: "#5b6b7b",
  lineaTarjeta: "#e6ecf1",
  rojo: "#e2574c",
  rojoFondo: "#fde8e6",
  ambar: "#c98a0b",
  ambarFondo: "#fdf1dc",
  verde: "#1f8a5b",
  verdeFondo: "#e3f4ec",
  amarillo: "#f5c04a",
  avisoFondo: "#2e4a44",
  avisoBorde: "#8a7a3e",
  alertaBorde: "#9a5a52",
  alertaFondo: "#3a3b48",
};

export const ESTADOS: Record<Estado, { txt: string; color: string }> = {
  ok: { txt: "Cumple", color: "#1f8a5b" },
  parcial: { txt: "Parcial", color: "#c98a0b" },
  falla: { txt: "No cumple", color: "#c0392b" },
  revisar: { txt: "Revisar", color: "#6b7c8f" },
  na: { txt: "No aplica", color: "#9aa7b4" },
};

// Colores de las etiquetas sobre fondo oscuro
const CHIP_OSCURO: Record<Estado, { txt: string; color: string; texto: string }> = {
  ok: { txt: "CUMPLE", color: "#34c38f", texto: "#06281c" },
  parcial: { txt: "A MEJORAR", color: "#f0b429", texto: "#2b1d00" },
  falla: { txt: "NO CUMPLE", color: "#ff6b5e", texto: "#2b0805" },
  revisar: { txt: "REVISAR", color: "#9fb3c2", texto: "#0b2a3c" },
  na: { txt: "NO APLICA", color: "#5d7a8a", texto: "#e6eef1" },
};

const colorNivel = (p: number) => (p >= 80 ? "#1f8a5b" : p >= 55 ? "#c98a0b" : "#c0392b");

const riesgo = (p: number) =>
  p >= 80
    ? { txt: "RIESGO BAJO", color: P.verde, anillo: "#34c38f" }
    : p >= 55
      ? { txt: "RIESGO MEDIO", color: P.ambar, anillo: "#f0b429" }
      : { txt: "RIESGO ALTO", color: P.rojo, anillo: P.rojo };

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

/** Enlace del botón "Hablar con RIDS": WhatsApp con mensaje prellenado si hay número configurado. */
function urlHablar(r: Resultado, cfg: ConfigInforme): string {
  const numero = (process.env.WHATSAPP_NUMERO || "").replace(/\D/g, ""); // solo dígitos
  if (!numero) return cfg.urlAgenda || "https://rids.cl/#contacto";

  const mensaje =
    `Hola RIDS, recibí el informe Ley 21.719 de ${r.dominio} ` +
    `(${r.puntaje}/100) y quiero ayuda para cumplir con la ley.`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}

/** Teléfono visible: TELEFONO_CONTACTO, o el número de WhatsApp con formato chileno. */
function telefonoVisible(cfg: ConfigInforme): string {
  if (cfg.telefono) return cfg.telefono;
  const n = (process.env.WHATSAPP_NUMERO || "").replace(/\D/g, "");
  const m = n.match(/^56(9)(\d{4})(\d{4})$/);
  return m ? `+56 ${m[1]} ${m[2]} ${m[3]}` : n ? `+${n}` : "";
}

// ============================================================
// PDF
// ============================================================

export function generarPdf(r: Resultado, contacto: ContactoInforme, cfg: ConfigInforme = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 56, left: 40, right: 40 },
      bufferPages: true,
      info: { Title: `Informe Ley 21.719 — ${r.dominio}`, Author: "RIDS", Subject: "Revisión pública del sitio web" },
    });

    const partes: Buffer[] = [];
    doc.on("data", (d: Buffer) => partes.push(d));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    // Fuentes: Poppins si está en assets/fonts, si no Helvetica
    if (HAY_POPPINS) {
      doc.registerFont("N", FUENTES.normal);
      doc.registerFont("S", FUENTES.semi);
      doc.registerFont("B", FUENTES.negrita);
    } else {
      doc.registerFont("N", "Helvetica");
      doc.registerFont("S", "Helvetica-Bold");
      doc.registerFont("B", "Helvetica-Bold");
    }

    const PW = doc.page.width;
    const PH = doc.page.height;
    const X = 40;
    const W = PW - 80;
    const LIMITE = PH - 56;

    // Fondo azul en todas las páginas (también las que pdfkit agrega solo)
    const pintarFondo = () => {
      doc.save();
      doc.rect(0, 0, PW, PH).fill(P.fondo);
      // Arcos decorativos como en la pieza de campaña
      doc.circle(PW - 40, 40, 150).lineWidth(1).strokeOpacity(0.12).stroke(P.celeste);
      doc.circle(PW - 40, 40, 210).lineWidth(1).strokeOpacity(0.07).stroke(P.celeste);
      doc.restore();
      doc.x = X;
      doc.y = doc.page.margins.top;
    };
    pintarFondo();
    doc.on("pageAdded", pintarFondo);

    const saltoSiFalta = (alto: number) => {
      if (doc.y + alto > LIMITE) doc.addPage();
    };

    const wa = urlHablar(r, cfg);
    const tel = telefonoVisible(cfg);
    const correoRids = cfg.correoContacto || "soporte@rids.cl";
    const rg = riesgo(r.puntaje);

    // ---------- Encabezado: logo + píldora ----------
    if (RUTA_LOGO) {
      try {
        doc.image(RUTA_LOGO, X, 40, { height: 48 });
      } catch {
        doc.font("B").fontSize(26).fill(P.blanco).text("RIDS", X, 48);
      }
    } else {
      doc.font("B").fontSize(26).fill(P.blanco).text("RIDS", X, 48);
    }

    const pildora = "INFORME GRATUITO";
    doc.font("B").fontSize(9);
    const anchoPildora = doc.widthOfString(pildora, { characterSpacing: 1 }) + 28;
    doc.roundedRect(X + W - anchoPildora, 50, anchoPildora, 26, 13).fill(P.celeste);
    doc.fill(P.tinta).text(pildora, X + W - anchoPildora, 58.5, {
      width: anchoPildora, align: "center", characterSpacing: 1, lineBreak: false,
    });

    // ---------- Aviso legal (chip) ----------
    let y = 104;
    const aviso = "Ley 21.719 rige el 1 de diciembre de 2026 · Multas de hasta 20.000 UTM";
    doc.font("S").fontSize(9);
    const anchoAviso = doc.widthOfString(aviso) + 40;
    doc.roundedRect(X, y, anchoAviso, 24, 6).fillAndStroke(P.alertaFondo, P.alertaBorde);
    doc.circle(X + 14, y + 12, 3).fill(P.rojo);
    doc.fill(P.texto).text(aviso, X + 24, y + 7.5, { lineBreak: false });

    // ---------- Titular ----------
    y += 40;
    doc.font("B").fontSize(30).fill(P.blanco).text("Así está su sitio web", X, y, { width: W, lineGap: -4 });
    doc.text("frente a la ", { continued: true, lineGap: -4 }).fill(P.celeste).text("Ley 21.719.", { lineGap: -4 });

    doc.moveDown(0.5);
    doc.font("N").fontSize(11.5).fill(P.texto).text("Revisamos ", X, doc.y, { width: W, continued: true, lineGap: 2 })
      .font("S").fill(P.blanco).text(r.dominio, { continued: true })
      .font("N").fill(P.texto).text(
        ` el ${fecha(r.fecha)}, tal como lo vería cualquier visitante. ` +
        `Preparado para ${contacto.nombre}${contacto.empresa ? ` (${contacto.empresa})` : ""}.`
      );

    // ---------- Tarjeta blanca con el puntaje ----------
    y = doc.y + 16;
    const pr = prioridades(r, 4);
    const filas = pr.length ? pr : null;
    const altoFila = 24;
    const altoTarjeta = 96 + (filas ? filas.length : 1) * altoFila + 14;
    saltoSiFalta(altoTarjeta);
    doc.roundedRect(X, y, W, altoTarjeta, 12).fill(P.blanco);

    // Anillo
    const cx = X + 52;
    const cy = y + 50;
    const rad = 30;
    doc.circle(cx, cy, rad).lineWidth(6).strokeOpacity(1).stroke("#eef2f5");
    const prop = Math.max(0, Math.min(100, r.puntaje)) / 100;
    if (prop >= 0.999) {
      doc.circle(cx, cy, rad).lineWidth(6).stroke(rg.anillo);
    } else if (prop > 0) {
      const ang = -Math.PI / 2 + prop * 2 * Math.PI;
      const x2 = cx + rad * Math.cos(ang);
      const y2 = cy + rad * Math.sin(ang);
      doc.path(`M ${cx} ${cy - rad} A ${rad} ${rad} 0 ${prop > 0.5 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`)
        .lineWidth(6).lineCap("round").stroke(rg.anillo);
      doc.lineCap("butt");
    }
    doc.font("B").fontSize(20).fill(P.tinta).text(String(r.puntaje), cx - 30, cy - 15, { width: 60, align: "center", lineBreak: false });
    doc.font("N").fontSize(7).fill(P.grisTarjeta).text("de 100", cx - 30, cy + 8, { width: 60, align: "center", lineBreak: false });

    // Riesgo + dominio
    doc.font("B").fontSize(8.5).fill(rg.color).text(rg.txt, X + 104, y + 30, { characterSpacing: 1, lineBreak: false });
    doc.font("B").fontSize(16).fill(P.tinta).text(r.dominio, X + 104, y + 44, { width: W - 124, lineBreak: false, ellipsis: true });
    doc.font("N").fontSize(8.5).fill(P.grisTarjeta).text(`Nivel ${r.nivel.toLowerCase()} · ${fecha(r.fecha)}`, X + 104, y + 66, { lineBreak: false });

    // Separador
    let fy = y + 94;
    doc.moveTo(X + 20, fy - 6).lineTo(X + W - 20, fy - 6).lineWidth(0.8).strokeOpacity(1).stroke(P.lineaTarjeta);

    // Filas de hallazgos
    if (filas) {
      for (const c of filas) {
        const critico = c.estado === "falla";
        const colorIcono = critico ? P.rojo : P.ambar;
        doc.circle(X + 30, fy + 9, 8).fill(critico ? P.rojoFondo : P.ambarFondo);
        if (critico) {
          doc.moveTo(X + 27, fy + 6).lineTo(X + 33, fy + 12).moveTo(X + 33, fy + 6).lineTo(X + 27, fy + 12)
            .lineWidth(1.6).stroke(colorIcono);
        } else {
          doc.font("B").fontSize(10).fill(colorIcono).text("!", X + 22, fy + 3, { width: 16, align: "center", lineBreak: false });
        }
        doc.font("N").fontSize(11).fill(P.tinta).text(c.titulo, X + 48, fy + 2, { width: W - 160, lineBreak: false, ellipsis: true });
        doc.font("S").fontSize(9).fill(critico ? P.rojo : P.ambar)
          .text(critico ? "Crítico" : "A mejorar", X + W - 110, fy + 4, { width: 90, align: "right", lineBreak: false });
        fy += altoFila;
      }
    } else {
      doc.circle(X + 30, fy + 9, 8).fill(P.verdeFondo);
      doc.moveTo(X + 26, fy + 9).lineTo(X + 29, fy + 12).lineTo(X + 34, fy + 6).lineWidth(1.6).stroke(P.verde);
      doc.font("N").fontSize(11).fill(P.tinta).text("Sin observaciones prioritarias en la revisión pública", X + 48, fy + 2, { lineBreak: false });
    }

    // ---------- Pasos 1-2-3 ----------
    y = y + altoTarjeta + 16;
    const gap = 12;
    const anchoPaso = (W - gap * 2) / 3;
    const altoPaso = 68;
    saltoSiFalta(altoPaso);
    const pasos = [
      ["Analizamos su sitio", "Revisión pública, en 1 minuto"],
      ["Recibe su informe", "Qué falla y cómo corregirlo"],
      ["Lo corregimos por usted", "Usted decide, nosotros lo hacemos"],
    ];
    pasos.forEach(([t, d], i) => {
      const px = X + i * (anchoPaso + gap);
      const activo = i === 2;
      doc.roundedRect(px, y, anchoPaso, altoPaso, 8).lineWidth(1)
        .fillAndStroke(activo ? P.panelActivo : P.panel, activo ? P.celeste : P.borde);
      doc.circle(px + 20, y + 20, 9).fill(P.celeste);
      doc.font("B").fontSize(9).fill(P.tinta).text(String(i + 1), px + 11, y + 15, { width: 18, align: "center", lineBreak: false });
      doc.font("B").fontSize(10).fill(P.blanco).text(t, px + 12, y + 34, { width: anchoPaso - 20, lineBreak: false, ellipsis: true });
      doc.font("N").fontSize(8).fill(P.suave).text(d, px + 12, y + 49, { width: anchoPaso - 20, lineBreak: false, ellipsis: true });
    });

    // ---------- Aviso de plazo ----------
    y += altoPaso + 12;
    saltoSiFalta(44);
    doc.roundedRect(X, y, W, 40, 8).lineWidth(1).fillAndStroke(P.avisoFondo, P.avisoBorde);
    // Ícono de calendario
    doc.roundedRect(X + 16, y + 13, 14, 13, 2).lineWidth(1.2).stroke(P.amarillo);
    doc.moveTo(X + 16, y + 17.5).lineTo(X + 30, y + 17.5).stroke(P.amarillo);
    doc.font("N").fontSize(10.5).fill(P.texto).text("Tiene ", X + 42, y + 13, { continued: true, lineBreak: false })
      .font("B").fill(P.amarillo).text("hasta el 1 de diciembre", { continued: true })
      .font("N").fill(P.texto).text(" para adecuar su sitio. ¡No lo deje para el último día!");

    // ---------- Botón principal (WhatsApp) ----------
    y += 52;
    saltoSiFalta(52);
    doc.roundedRect(X, y, W, 48, 8).fill(P.celeste);
    const textoBoton = "Hablar con RIDS por WhatsApp";
    doc.font("B").fontSize(15).fill(P.tinta).text(textoBoton, X + 22, y + 14, { lineBreak: false });
    // Flecha dibujada (la fuente no trae el carácter →)
    const fx = X + 22 + doc.widthOfString(textoBoton) + 12;
    const fyb = y + 24.5;
    doc.moveTo(fx, fyb).lineTo(fx + 14, fyb).moveTo(fx + 9, fyb - 4.5).lineTo(fx + 14, fyb).lineTo(fx + 9, fyb + 4.5)
      .lineWidth(1.8).lineCap("round").stroke(P.tinta);
    doc.lineCap("butt");
    doc.font("S").fontSize(9.5).fill(P.tinta).text("rids.cl", X + W - 90, y + 18, { width: 70, align: "right", lineBreak: false });
    doc.link(X, y, W, 48, wa);

    // ---------- Contacto ----------
    y += 62;
    const contactoLinea = (etiqueta: string, valor: string, ly: number, lx: number, url?: string) => {
      doc.font("S").fontSize(8).fill(P.celeste).text(etiqueta, lx, ly + 1.5, { lineBreak: false, characterSpacing: 0.5 });
      const ancho = doc.widthOfString(etiqueta, { characterSpacing: 0.5 });
      doc.font("N").fontSize(11).fill(P.blanco).text(valor, lx + ancho + 8, ly, { lineBreak: false });
      if (url) doc.link(lx, ly - 2, ancho + 8 + doc.widthOfString(valor), 16, url);
    };
    if (y + 34 <= PH - 40) {
      contactoLinea("WEB", "www.rids.cl/analizador-ley-21719", y, X, "https://www.rids.cl/analizador-ley-21719");
      if (tel) contactoLinea("WHATSAPP", tel, y + 22, X, wa);
      contactoLinea("CORREO", correoRids, y + 22, tel ? X + 230 : X, `mailto:${correoRids}`);
    }

    // =========================================================
    // PÁGINAS DE DETALLE
    // =========================================================
    doc.addPage();

    const tituloSeccion = (t: string, sub?: string) => {
      saltoSiFalta(60);
      doc.font("B").fontSize(18).fill(P.blanco).text(t, X, doc.y, { width: W });
      doc.moveTo(X, doc.y + 4).lineTo(X + 40, doc.y + 4).lineWidth(2.5).strokeOpacity(1).stroke(P.celeste);
      doc.moveDown(0.6);
      if (sub) {
        doc.font("N").fontSize(9.5).fill(P.suave).text(sub, X, doc.y, { width: W });
        doc.moveDown(0.6);
      } else {
        doc.moveDown(0.2);
      }
    };

    const chip = (estado: Estado, cx0: number, cy0: number) => {
      const e = CHIP_OSCURO[estado];
      doc.roundedRect(cx0, cy0, 66, 16, 8).fill(e.color);
      doc.font("B").fontSize(6.8).fill(e.texto).text(e.txt, cx0, cy0 + 4.6, { width: 66, align: "center", lineBreak: false, characterSpacing: 0.4 });
    };

    // Resumen por área
    tituloSeccion("Resumen por área", `Puntaje ${r.puntaje}/100 · Nivel ${r.nivel.toLowerCase()}`);
    for (const c of r.categorias) {
      saltoSiFalta(38);
      const ry = doc.y;
      doc.roundedRect(X, ry, W, 32, 6).lineWidth(0.8).fillAndStroke(P.panel, P.borde);
      doc.font("S").fontSize(11).fill(P.blanco).text(c.nombre, X + 14, ry + 9.5, { width: W - 230, lineBreak: false, ellipsis: true });
      const resumen = c.fallas
        ? `${c.fallas} incumplimiento(s)${c.parciales ? `, ${c.parciales} por mejorar` : ""}`
        : c.parciales ? `${c.parciales} por mejorar` : "Sin observaciones";
      doc.font("N").fontSize(8.5).fill(P.suave).text(resumen, X + W - 270, ry + 11, { width: 180, align: "right", lineBreak: false });
      chip(c.estado, X + W - 80, ry + 8);
      doc.y = ry + 40;
    }
    doc.moveDown(0.8);

    // Detalle por control
    tituloSeccion("Detalle de la revisión", "Cada punto indica el artículo de la ley, lo que encontramos y cómo corregirlo.");
    const anchoTexto = W - 28;
    for (const cat of r.categorias) {
      saltoSiFalta(80);
      doc.font("B").fontSize(12).fill(P.celeste).text(cat.nombre.toUpperCase(), X, doc.y, { width: W, characterSpacing: 0.6 });
      doc.moveDown(0.4);

      for (const c of r.controles.filter((x) => x.categoria === cat.nombre)) {
        // Alto del panel según su contenido
        doc.font("B").fontSize(10.5);
        const hTitulo = doc.heightOfString(c.titulo, { width: anchoTexto - 150 });
        doc.font("N").fontSize(9);
        const hDetalle = doc.heightOfString(c.detalle, { width: anchoTexto });
        const faltan = c.faltan?.length ? `Falta: ${c.faltan.join("; ")}.` : "";
        doc.fontSize(8.5);
        const hFaltan = faltan ? doc.heightOfString(faltan, { width: anchoTexto }) + 4 : 0;
        doc.font("S").fontSize(9);
        const reco = c.recomendacion ? `Recomendación: ${c.recomendacion}` : "";
        const hReco = reco ? doc.heightOfString(reco, { width: anchoTexto }) + 4 : 0;
        const alto = 14 + Math.max(hTitulo, 16) + 6 + hDetalle + hFaltan + hReco + 12;

        saltoSiFalta(alto + 8);
        const py = doc.y;
        doc.roundedRect(X, py, W, alto, 6).lineWidth(0.8).fillAndStroke(P.panel, P.borde);

        chip(c.estado, X + 14, py + 13);
        doc.font("B").fontSize(10.5).fill(P.blanco).text(c.titulo, X + 90, py + 13, { width: anchoTexto - 150 });
        doc.font("N").fontSize(8).fill(P.suave).text(c.ley, X + W - 124, py + 15, { width: 110, align: "right", lineBreak: false });

        let ty = py + 14 + Math.max(hTitulo, 16) + 6;
        doc.font("N").fontSize(9).fill(P.texto).text(c.detalle, X + 14, ty, { width: anchoTexto });
        ty += hDetalle;
        if (faltan) {
          doc.font("N").fontSize(8.5).fill(P.suave).text(faltan, X + 14, ty + 4, { width: anchoTexto });
          ty += hFaltan;
        }
        if (reco) {
          doc.font("S").fontSize(9).fill(P.celeste).text(reco, X + 14, ty + 4, { width: anchoTexto });
        }
        doc.y = py + alto + 8;
      }
      doc.moveDown(0.6);
    }

    // Servicios de terceros
    if (r.datos.servicios.length) {
      tituloSeccion("Servicios de terceros detectados");
      for (const s of r.datos.servicios) {
        saltoSiFalta(18);
        const sy = doc.y;
        doc.circle(X + 4, sy + 6, 2.5).fill(P.celeste);
        doc.font("S").fontSize(9.5).fill(P.blanco).text(s.nombre, X + 14, sy, { continued: true })
          .font("N").fill(P.suave).text(` — ${s.tipo}${s.cookies ? " (instala cookies)" : ""}`);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.8);
    }

    // Alcance + cierre
    tituloSeccion("Alcance de esta revisión");
    doc.font("N").fontSize(9).fill(P.suave).text(
      "Este informe revisa en forma automática la página de inicio, la política de privacidad enlazada y la configuración pública del dominio. " +
      "No revisa sistemas internos, bases de datos, contratos con proveedores, registro de actividades de tratamiento, protocolos de vulneraciones " +
      "ni otras obligaciones de la Ley 21.719 que no son visibles desde internet. No constituye asesoría legal." +
      (r.sitio.spa
        ? " Este sitio arma su contenido con JavaScript: los enlaces legales, el aviso de cookies y los formularios se dedujeron de su código, " +
        "y los puntos marcados como \"Revisar\" conviene confirmarlos abriendo el sitio en un navegador."
        : ""),
      X, doc.y, { width: W, align: "justify", lineGap: 1.5 }
    );
    doc.moveDown(1.2);

    // Cierre: solo si cabe en la página actual (la portada ya tiene el botón principal)
    if (doc.y + 84 <= LIMITE) {
      const yC = doc.y;
      doc.roundedRect(X, yC, W, 76, 8).fill(P.celeste);
      doc.font("B").fontSize(14).fill(P.tinta).text("¿Le ayudamos a cumplir antes del 1 de diciembre?", X + 20, yC + 14, { width: W - 40 });
      doc.font("N").fontSize(9.5).fill(P.tinta).text(
        `Implementamos la política, el banner de cookies, los formularios y las medidas de seguridad. ` +
        `Escríbanos por WhatsApp${tel ? ` al ${tel}` : ""} o a ${correoRids}.`,
        X + 20, yC + 36, { width: W - 40 }
      );
      doc.link(X, yC, W, 76, wa);
    }

    // Pie en todas las páginas
    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) {
      doc.switchToPage(i);
      const fondo = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("N").fontSize(7.5).fill(P.suave)
        .text(`RIDS · rids.cl · Informe ${r.dominio} · Página ${i + 1} de ${n}`, X, PH - 30, { width: W, align: "center", lineBreak: false });
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
  <a href="${esc(urlHablar(r, cfg))}" style="display:inline-block;background:${CELESTE};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:6px">Hablar con RIDS</a>
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
