// src/utils/correo.ts
// Envío de correo compartido (formulario de contacto + analizador Ley 21.719).
//
// 1) Si están las variables GRAPH_* → Microsoft Graph API (HTTPS, puerto 443).
//    Funciona en cualquier plan de Railway, porque no usa SMTP.
// 2) Si no → SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS). Útil en local.
//
// Variables Graph:
//   GRAPH_TENANT_ID      Id. de directorio (tenant) de Entra ID
//   GRAPH_CLIENT_ID      Id. de aplicación (cliente)
//   GRAPH_CLIENT_SECRET  Secreto de cliente
//   GRAPH_SENDER         Buzón que envía (ej. no-responder@rids.cl). Si falta, usa SMTP_USER.

import fs from "node:fs";
import nodemailer from "nodemailer";
import type { Attachment } from "nodemailer/lib/mailer";

export type Mensaje = {
  para: string;
  asunto: string;
  html?: string;
  texto: string;
  adjuntos?: Attachment[];
  responderA?: string;
  /** Nombre visible del remitente (solo SMTP; en Graph se usa el nombre del buzón). */
  nombreRemitente?: string;
};

const usaGraph = () =>
  Boolean(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);

const smtpConfigurado = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const buzonGraph = () => process.env.GRAPH_SENDER || process.env.SMTP_USER || "";

export const correoConfigurado = (): boolean => (usaGraph() && Boolean(buzonGraph())) || smtpConfigurado();

/** Correo de RIDS que se muestra al cliente y recibe los avisos internos. */
export const correoRids = (): string => process.env.CONTACT_EMAIL || "soporte@rids.cl";

export async function enviarCorreo(m: Mensaje): Promise<void> {
  if (usaGraph()) return enviarGraph(m);
  if (smtpConfigurado()) return enviarSmtp(m);
  throw new Error("Correo no configurado (faltan variables GRAPH_* o SMTP_*)");
}

// ============================================================
// MICROSOFT GRAPH
// ============================================================

let token: { valor: string; vence: number } | null = null;

async function obtenerToken(): Promise<string> {
  if (token && Date.now() < token.vence) return token.valor;

  const r = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID as string,
        client_secret: process.env.GRAPH_CLIENT_SECRET as string,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!r.ok || !j.access_token) {
    // error_description no contiene el secreto; se recorta por si es largo
    throw new Error(`Graph token ${r.status}: ${j.error || ""} ${(j.error_description || "").slice(0, 160)}`);
  }

  // Se renueva 5 minutos antes de vencer
  token = { valor: j.access_token, vence: Date.now() + ((j.expires_in || 3600) - 300) * 1000 };
  return token.valor;
}

function tipoPorExtension(nombre: string): string {
  const ext = nombre.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function adjuntoGraph(a: Attachment) {
  let contenido: Buffer;
  if (Buffer.isBuffer(a.content)) contenido = a.content;
  else if (typeof a.content === "string") contenido = Buffer.from(a.content);
  else if (typeof a.path === "string") contenido = fs.readFileSync(a.path);
  else throw new Error("Adjunto sin contenido");

  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename || "adjunto",
    contentType: a.contentType || tipoPorExtension(a.filename || ""),
    contentBytes: contenido.toString("base64"),
    ...(a.cid ? { isInline: true, contentId: a.cid } : {}), // imagen incrustada (src="cid:...")
  };
}

async function enviarGraph({ para, asunto, html, texto, adjuntos = [], responderA }: Mensaje) {
  const buzon = buzonGraph();
  if (!buzon) throw new Error("Falta GRAPH_SENDER (buzón que envía)");

  const enviar = async (accessToken: string) =>
    fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(buzon)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: asunto,
          body: html ? { contentType: "HTML", content: html } : { contentType: "Text", content: texto },
          toRecipients: [{ emailAddress: { address: para } }],
          replyTo: [{ emailAddress: { address: responderA || correoRids() } }],
          attachments: adjuntos.map(adjuntoGraph),
        },
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

  let r = await enviar(await obtenerToken());

  // Token revocado o vencido antes de tiempo: se pide uno nuevo y se reintenta una vez
  if (r.status === 401) {
    token = null;
    r = await enviar(await obtenerToken());
  }

  if (r.status !== 202) {
    const detalle = await r.text().catch(() => "");
    throw new Error(`Graph sendMail ${r.status}: ${detalle.slice(0, 200)}`);
  }
}

// ============================================================
// SMTP (misma configuración que tenía contact.controller.ts)
// ============================================================

async function enviarSmtp({ para, asunto, html, texto, adjuntos = [], responderA, nombreRemitente = "RIDS" }: Mensaje) {
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: `"${nombreRemitente}" <${process.env.SMTP_USER}>`,
      to: para,
      replyTo: responderA || correoRids(),
      subject: asunto,
      html,
      text: texto,
      attachments: adjuntos,
    });
  } finally {
    transporter.close();
  }
}
