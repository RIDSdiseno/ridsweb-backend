// src/analizador/correo.ts
// Envío de correo del analizador. Usa la MISMA configuración SMTP que el formulario de contacto
// (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) y el mismo criterio: puerto 465 = conexión segura.

import nodemailer, { type Transporter } from "nodemailer";
import type { Attachment } from "nodemailer/lib/mailer";

let transporte: Transporter | null = null;

export const correoConfigurado = (): boolean =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/** Correo de RIDS que se muestra al cliente y recibe los avisos internos. */
export const correoRids = (): string => process.env.CONTACT_EMAIL || "soporte@rids.cl";

function obtenerTransporte(): Transporter {
  if (transporte) return transporte;
  if (!correoConfigurado()) throw new Error("Configuración SMTP incompleta");

  const puerto = Number(process.env.SMTP_PORT) || 587;
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    requireTLS: puerto !== 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporte;
}

export async function enviarCorreo({
  para,
  asunto,
  html,
  texto,
  adjuntos = [],
  responderA,
}: {
  para: string;
  asunto: string;
  html?: string;
  texto: string;
  adjuntos?: Attachment[];
  responderA?: string;
}) {
  return obtenerTransporte().sendMail({
    from: `"RIDS" <${process.env.SMTP_USER}>`,
    to: para,
    replyTo: responderA || correoRids(),
    subject: asunto,
    html,
    text: texto,
    attachments: adjuntos,
  });
}
