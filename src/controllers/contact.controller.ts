// src/controllers/contact.controller.ts
import type { Request, Response } from "express";
import nodemailer from "nodemailer";

export async function handleContactForm(req: Request, res: Response) {
  try {
    const { nombre, email, mensaje, categoria } = req.body;

    if (!nombre || !email || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Faltan campos obligatorios: nombre, email o mensaje",
      });
    }

    console.log("📩 Nuevo mensaje de contacto:", {
      nombre,
      email,
      mensaje,
      categoria,
    });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const categoriaTexto = categoria || "Sin categoría seleccionada";

    await transporter.sendMail({
      from: `"Formulario Web RIDS" <informaciones@rids.cl>`,
      to: "informaciones@rids.cl",
      replyTo: email,
      subject: `[${categoriaTexto}] Nuevo mensaje de ${nombre}`,
      text: `
Categoría: ${categoriaTexto}
Nombre: ${nombre}
Email: ${email}

Mensaje:
${mensaje}
      `,
      html: `
        <h3>Nuevo mensaje desde el formulario web</h3>
        <p><b>Categoría:</b> ${categoriaTexto}</p>
        <p><b>Nombre:</b> ${nombre}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Mensaje:</b></p>
        <p>${mensaje.replace(/\n/g, "<br/>")}</p>
      `,
    });

    return res.json({
      ok: true,
      message: "Contacto recibido. Gracias por escribir a RIDS ✅",
    });
  } catch (error) {
    console.error("Error enviando correo:", error);
    return res.status(500).json({
      ok: false,
      error: "Error enviando el correo",
    });
  }
}
