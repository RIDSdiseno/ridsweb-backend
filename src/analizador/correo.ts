// src/analizador/correo.ts
// Envío de correo del analizador.
// Usa EXACTAMENTE la misma conexión SMTP que contact.controller.ts:
// mismas variables, secure solo en el puerto 465 y un transporte nuevo en cada envío.

import nodemailer from "nodemailer";
import type { Attachment } from "nodemailer/lib/mailer";

export const correoConfigurado = (): boolean =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/** Correo de RIDS que se muestra al cliente y recibe los avisos internos. */
export const correoRids = (): string => process.env.CONTACT_EMAIL || "soporte@rids.cl";

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
}): Promise<void> {
  if (!correoConfigurado()) throw new Error("Configuración SMTP incompleta");

  const smtpPort = Number(process.env.SMTP_PORT) || 587;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const inicio = Date.now();
  try {
    await transporter.sendMail({
      from: `"RIDS" <${process.env.SMTP_USER}>`,
      to: para,
      replyTo: responderA || correoRids(),
      subject: asunto,
      html,
      text: texto,
      attachments: adjuntos,
    });
  } catch (e) {
    // Diagnóstico sin datos personales: servidor, puerto y cuánto tardó en fallar
    const err = e as Error & { code?: string };
    console.error("[ANALIZADOR] SMTP falló", {
      host: process.env.SMTP_HOST,
      port: smtpPort,
      code: err.code,
      ms: Date.now() - inicio,
    });
    throw e;
  } finally {
    transporter.close();
  }
}