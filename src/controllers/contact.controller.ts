// src/controllers/contact.controller.ts

import type {
  Request,
  Response,
} from "express";

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

function normalizeString(
  value: unknown
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function escapeHtml(
  value: string
): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmail(
  email: string
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function formatChileDate(
  date: Date
): string {
  return new Intl.DateTimeFormat(
    "es-CL",
    {
      timeZone: "America/Santiago",

      year: "numeric",
      month: "2-digit",
      day: "2-digit",

      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",

      hour12: false,
    }
  ).format(date);
}

export async function handleContactForm(
  req: Request,
  res: Response
) {
  try {
    // ========================================
    // DATOS RECIBIDOS
    // ========================================

    const nombre =
      normalizeString(
        req.body?.nombre
      );

    const email =
      normalizeString(
        req.body?.email
      );

    const categoria =
      normalizeString(
        req.body?.categoria
      );

    const mensaje =
      normalizeString(
        req.body?.mensaje
      );

    const privacyRead =
      req.body?.privacyRead === true;

    // ========================================
    // VALIDACIÓN CAMPOS
    // ========================================

    if (
      !nombre ||
      !email ||
      !categoria ||
      !mensaje
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "Todos los campos son obligatorios.",
      });
    }

    if (
      nombre.length < 2 ||
      nombre.length > 120
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "El nombre ingresado no es válido.",
      });
    }

    if (
      email.length > 254 ||
      !isValidEmail(email)
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "El correo electrónico ingresado no es válido.",
      });
    }

    if (
      !CATEGORIAS_PERMITIDAS.includes(
        categoria
      )
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "La categoría seleccionada no es válida.",
      });
    }

    if (
      mensaje.length < 5 ||
      mensaje.length > 5000
    ) {
      return res.status(400).json({
        ok: false,

        error:
          "El mensaje debe contener entre 5 y 5000 caracteres.",
      });
    }

    // ========================================
    // VALIDACIÓN POLÍTICA DE PRIVACIDAD
    // ========================================

    if (!privacyRead) {
      return res.status(400).json({
        ok: false,

        error:
          "Debes confirmar que has leído la Política de Privacidad.",
      });
    }

    // ========================================
    // FECHA / HORA DEL ENVÍO
    // ========================================

    const submittedAt =
      new Date();

    const submittedAtISO =
      submittedAt.toISOString();

    const submittedAtChile =
      formatChileDate(
        submittedAt
      );

    // ========================================
    // LOG SEGURO
    // ========================================

    // No guardar nombre, email ni mensaje
    // en logs.

    console.log(
      "[CONTACT] Formulario recibido",
      {
        categoria,
        privacyRead,
        timestamp:
          submittedAtISO,
      }
    );

    // ========================================
    // SMTP
    // ========================================

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
      Number(
        process.env.SMTP_PORT
      ) || 587;

    const transporter =
      nodemailer.createTransport({
        host:
          process.env.SMTP_HOST,

        port:
          smtpPort,

        secure:
          smtpPort === 465,

        auth: {
          user:
            process.env.SMTP_USER,

          pass:
            process.env.SMTP_PASS,
        },
      });

    // ========================================
    // ESCAPADO HTML
    // ========================================

    const nombreSeguro =
      escapeHtml(
        nombre
      );

    const emailSeguro =
      escapeHtml(
        email
      );

    const categoriaSegura =
      escapeHtml(
        categoria
      );

    const mensajeSeguro =
      escapeHtml(
        mensaje
      ).replace(
        /\n/g,
        "<br/>"
      );

    const fechaChileSegura =
      escapeHtml(
        submittedAtChile
      );

    const fechaISOSegura =
      escapeHtml(
        submittedAtISO
      );

    // ========================================
    // CORREO
    // ========================================

    await transporter.sendMail({
      from:
        `"Formulario Web RIDS" <${process.env.SMTP_USER}>`,

      to:
        process.env.CONTACT_EMAIL ||
        "soporte@rids.cl",

      replyTo:
        email,

      subject:
        `[${categoria}] Nuevo mensaje desde rids.cl`,

      // ======================================
      // VERSIÓN TEXTO
      // ======================================

      text: `
Nuevo mensaje desde el formulario web de RIDS.

Categoría: ${categoria}
Nombre: ${nombre}
Email: ${email}

Mensaje:
${mensaje}

----------------------------------------
PRIVACIDAD Y REGISTRO DEL ENVÍO
----------------------------------------

Política de Privacidad leída: Sí
Fecha y hora del envío (Chile): ${submittedAtChile}
Referencia UTC: ${submittedAtISO}
      `.trim(),

      // ======================================
      // VERSIÓN HTML
      // ======================================

      html: `
        <div
          style="
            font-family: Arial, sans-serif;
            color: #1f2937;
            line-height: 1.6;
          "
        >
          <h2>
            Nuevo mensaje desde rids.cl
          </h2>

          <p>
            <strong>
              Categoría:
            </strong>
            ${categoriaSegura}
          </p>

          <p>
            <strong>
              Nombre:
            </strong>
            ${nombreSeguro}
          </p>

          <p>
            <strong>
              Correo:
            </strong>
            ${emailSeguro}
          </p>

          <p>
            <strong>
              Mensaje:
            </strong>
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

          <div
            style="
              margin-top: 24px;
              padding: 14px 16px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
            "
          >
            <p
              style="
                margin-top: 0;
                font-weight: bold;
              "
            >
              Registro del envío
            </p>

            <p>
              <strong>
                Política de Privacidad leída:
              </strong>
              Sí
            </p>

            <p>
              <strong>
                Fecha y hora del envío
                (America/Santiago):
              </strong>
              ${fechaChileSegura}
            </p>

            <p>
              <strong>
                Referencia UTC:
              </strong>
              ${fechaISOSegura}
            </p>
          </div>
        </div>
      `,
    });

    // ========================================
    // RESPUESTA
    // ========================================

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