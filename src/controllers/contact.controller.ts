// src/controllers/contact.controller.ts
import type { Request, Response } from "express";
import nodemailer from "nodemailer";

const CATEGORIAS_PERMITIDAS = [
  "Atención de Emergencias. SOS Soporte.cl",
  "Instalación y revisión de equipos",
  "Mantención de red y equipos computacionales",
  "Asesoría TI Storage y respaldos",
  "Manutenciones Lógicas y Físicas",
  "Cableado estructurado",
  "Asesoría TI Servidores Web",
  "Configuración de Servidores y correos",
  "Configuración de Impresoras de red",
  "Diseño Web a medida",
  "Plataformas de sistemas web",
  "Migración de correos",
];

function normalizeString(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function handleContactForm(
  req: Request,
  res: Response
) {
  try {
    const nombre = normalizeString(req.body?.nombre);
    const email = normalizeString(req.body?.email);
    const categoria = normalizeString(req.body?.categoria);
    const mensaje = normalizeString(req.body?.mensaje);

    // =========================
    // VALIDACIÓN
    // =========================

    if (!nombre || !email || !categoria || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Todos los campos son obligatorios.",
      });
    }

    if (nombre.length < 2 || nombre.length > 120) {
      return res.status(400).json({
        ok: false,
        error: "El nombre ingresado no es válido.",
      });
    }

    if (email.length > 254 || !isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: "El correo electrónico ingresado no es válido.",
      });
    }

    if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
      return res.status(400).json({
        ok: false,
        error: "La categoría seleccionada no es válida.",
      });
    }

    if (mensaje.length < 5 || mensaje.length > 5000) {
      return res.status(400).json({
        ok: false,
        error:
          "El mensaje debe contener entre 5 y 5000 caracteres.",
      });
    }

    // No guardar nombre/email/mensaje en logs.
    console.log("[CONTACT] Formulario recibido", {
      categoria,
      timestamp: new Date().toISOString(),
    });

    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      console.error(
        "[CONTACT] Configuración SMTP incompleta"
      );

      return res.status(500).json({
        ok: false,
        error:
          "El servicio de contacto no está disponible temporalmente.",
      });
    }

    const smtpPort =
      Number(process.env.SMTP_PORT) || 587;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,

      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const nombreSeguro =
      escapeHtml(nombre);

    const emailSeguro =
      escapeHtml(email);

    const categoriaSegura =
      escapeHtml(categoria);

    const mensajeSeguro =
      escapeHtml(mensaje).replace(
        /\n/g,
        "<br/>"
      );

    await transporter.sendMail({
      from:
        `"Formulario Web RIDS" <${process.env.SMTP_USER}>`,

      to:
        process.env.CONTACT_EMAIL ||
        "soporte@rids.cl",

      replyTo: email,

      subject:
        `[${categoria}] Nuevo mensaje desde rids.cl`,

      text: `
Nuevo mensaje desde el formulario web de RIDS.

Categoría: ${categoria}
Nombre: ${nombre}
Email: ${email}

Mensaje:
${mensaje}
      `.trim(),

      html: `
        <div
          style="
            font-family: Arial, sans-serif;
            color: #1f2937;
            line-height: 1.6;
          "
        >
          <h2>Nuevo mensaje desde rids.cl</h2>

          <p>
            <strong>Categoría:</strong>
            ${categoriaSegura}
          </p>

          <p>
            <strong>Nombre:</strong>
            ${nombreSeguro}
          </p>

          <p>
            <strong>Correo:</strong>
            ${emailSeguro}
          </p>

          <p>
            <strong>Mensaje:</strong>
          </p>

          <div
            style="
              padding: 12px;
              background: #f3f4f6;
              border-radius: 8px;
            "
          >
            ${mensajeSeguro}
          </div>
        </div>
      `,
    });

    return res.status(200).json({
      ok: true,
      message:
        "Contacto recibido. Gracias por escribir a RIDS.",
    });
  } catch (error) {
    console.error(
      "[CONTACT] Error:",
      error instanceof Error
        ? error.message
        : "Error desconocido"
    );

    return res.status(500).json({
      ok: false,
      error:
        "No fue posible enviar tu mensaje. Intenta nuevamente más tarde.",
    });
  }
}