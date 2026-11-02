// src/analizador/red.ts
// Acceso seguro a sitios de terceros: solo http/https públicos (sin IPs internas), tiempo y tamaño acotados.

import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { Agent, fetch, type Response as RespuestaUndici } from "undici";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 RIDS-Analizador-Ley21719";

const CABECERAS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CL,es;q=0.9",
};

const MAX_BYTES = 3 * 1024 * 1024;

export class ErrorUsuario extends Error { }

export interface Pagina {
  url: string;
  status: number;
  headers: Headers | import("undici").Headers;
  html: string;
  cookies: string[];
  saltos: string[];
}

export interface Certificado {
  valido: boolean;
  error: string | null;
  emisor?: string;
  vence?: string;
  diasRestantes?: number;
}

export interface RegistrosCorreo {
  mx: string[];
  spf: string | null;
  dmarc: string | null;
  dmarcPolitica: string | null;
}

export function ipPrivada(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / metadatos de nube
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||             // 192.0.0.0/24 y 192.0.2.0/24
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) {
    const resto = x.slice(7);
    // Forma punteada (::ffff:127.0.0.1) o hexadecimal (::ffff:7f00:1)
    if (net.isIPv4(resto)) return ipPrivada(resto);
    return true;
  }
  return (
    x === "::" || x === "::1" ||
    x.startsWith("fc") || x.startsWith("fd") ||
    x.startsWith("fe80") || x.startsWith("ff") ||
    x.startsWith("64:ff9b:")                // NAT64 (puede apuntar a IPv4 internas)
  );
}

// La conexión real también se valida (evita que el DNS cambie entre la revisión y la descarga)
const agente = new Agent({
  connect: {
    lookup: ((host: string, opts: { all?: boolean } | undefined, cb: (...a: unknown[]) => void) => {
      dns.lookup(host, { all: true }).then((ips) => {
        const malo = ips.find((r) => ipPrivada(r.address));
        if (!ips.length || malo) return cb(new Error("Destino no permitido"));
        if (opts?.all) return cb(null, ips);
        cb(null, ips[0].address, ips[0].family);
      }, cb);
    }) as never,
  },
});

/** Normaliza lo que escribe el usuario a un dominio ("https://www.Sitio.cl/x" -> "sitio.cl"). */
export function normalizarDominio(entrada: unknown): string {
  let t = String(entrada ?? "").trim().toLowerCase();
  if (!t) throw new ErrorUsuario("Escriba la dirección de su sitio web.");
  if (!/^https?:\/\//.test(t)) t = "https://" + t;

  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ErrorUsuario("La dirección no es válida.");
  }

  const host = u.hostname.replace(/^www\./, "");
  if (!/^(?=.{4,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,}$/.test(host) || net.isIP(host)) {
    throw new ErrorUsuario("Escriba un dominio, por ejemplo: miempresa.cl");
  }
  return host;
}

export async function hostPublico(host: string): Promise<void> {
  let ips: { address: string }[];
  try {
    ips = await dns.lookup(host, { all: true });
  } catch {
    throw new ErrorUsuario(`No encontramos el dominio ${host}. Revise que esté bien escrito.`);
  }
  if (!ips.length || ips.some((r) => ipPrivada(r.address))) {
    throw new ErrorUsuario("Ese dominio no apunta a un sitio público.");
  }
}

/** GET siguiendo redirecciones a mano: valida cada salto y junta las cookies de todas las respuestas. */
export async function obtener(
  url: string,
  { timeout = 15000, maxSaltos = 6 }: { timeout?: number; maxSaltos?: number } = {}
): Promise<Pagina> {
  const cookies = new Set<string>();
  const saltos: string[] = [];
  let actual = url;

  for (let i = 0; i <= maxSaltos; i++) {
    const u = new URL(actual);
    if (!["http:", "https:"].includes(u.protocol) || (u.port && !["80", "443"].includes(u.port))) {
      throw new Error("Redirección a un destino no permitido");
    }
    await hostPublico(u.hostname);

    const res = await fetch(actual, {
      headers: CABECERAS,
      redirect: "manual",
      dispatcher: agente,
      signal: AbortSignal.timeout(timeout),
    });

    for (const c of res.headers.getSetCookie?.() ?? []) cookies.add(c.split("=")[0].trim());
    saltos.push(actual);

    const destino = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destino) {
      await res.body?.cancel();
      actual = new URL(destino, actual).toString();
      continue;
    }

    const html = await leerAcotado(res.body);
    return { url: actual, status: res.status, headers: res.headers, html, cookies: [...cookies], saltos };
  }
  throw new Error("Demasiadas redirecciones");
}

async function leerAcotado(body: RespuestaUndici["body"]): Promise<string> {
  if (!body) return "";
  const lector = body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (; ;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await lector.cancel();
      break;
    }
    partes.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(partes));
}

export function certificado(host: string): Promise<Certificado> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
      const c = s.getPeerCertificate();
      const autorizado = s.authorized;
      const error = s.authorizationError;
      s.end();
      if (!c || !c.valid_to) return resolve({ valido: false, error: "Sin certificado" });
      const vence = new Date(c.valid_to);
      resolve({
        valido: autorizado,
        error: autorizado ? null : `Certificado no válido (${error})`,
        emisor: [c.issuer?.O, c.issuer?.CN].flat().find(Boolean) || "",
        vence: vence.toISOString().slice(0, 10),
        diasRestantes: Math.floor((vence.getTime() - Date.now()) / 86400000),
      });
    });
    s.on("timeout", () => {
      s.destroy();
      resolve({ valido: false, error: "Sin respuesta en el puerto 443" });
    });
    s.on("error", (e: NodeJS.ErrnoException) =>
      resolve({ valido: false, error: `Sin conexión HTTPS (${e.code || e.message})` })
    );
  });
}

export async function registrosCorreo(dominio: string): Promise<RegistrosCorreo> {
  const txt = async (n: string) => {
    try {
      return (await dns.resolveTxt(n)).map((r) => r.join(""));
    } catch {
      return [] as string[];
    }
  };

  let mx: string[] = [];
  try {
    mx = (await dns.resolveMx(dominio)).map((r) => r.exchange.toLowerCase());
  } catch {
    /* sin MX */
  }

  const spf = (await txt(dominio)).find((r) => /^v=spf1/i.test(r)) || null;
  const dmarc = (await txt(`_dmarc.${dominio}`)).find((r) => /^v=DMARC1/i.test(r)) || null;
  const dmarcPolitica = dmarc?.match(/;\s*p\s*=\s*(\w+)/i)?.[1]?.toLowerCase() || null;
  return { mx, spf, dmarc, dmarcPolitica };
}
