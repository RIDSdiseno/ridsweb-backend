// src/analizador/navegador.ts
// Carga opcional con navegador real (Playwright/Chromium): ve lo que arma JavaScript y las cookies
// que se instalan antes de que el visitante acepte. Sin Playwright instalado (o con USAR_NAVEGADOR=0)
// el análisis usa solo el HTML.

import dns from "node:dns/promises";
import { ipPrivada } from "./red";

export interface Vista {
  estado: number;
  html?: string;
  texto?: string;
  cookies?: { nombre: string; origen: string }[];
}

// Playwright es opcional: se carga por nombre para no exigirlo al compilar
const MODULO_PLAYWRIGHT = "playwright";

let navegador: any = null;
let disponible: boolean | null = null; // se decide al primer uso
let enUso = 0;
const max = () => Number(process.env.NAVEGADOR_CONCURRENCIA || 2);

async function abrir(): Promise<any> {
  if (disponible === null) disponible = process.env.USAR_NAVEGADOR === "1";
  if (!disponible) return null;
  if (navegador?.isConnected()) return navegador;
  try {
    const { chromium } = await import(MODULO_PLAYWRIGHT);
    navegador = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    return navegador;
  } catch (e) {
    disponible = false;
    console.warn(
      "[analizador] Playwright no disponible, se analiza solo el HTML:",
      (e as Error).message.split("\n")[0]
    );
    return null;
  }
}

const cacheHost = new Map<string, boolean>();

async function hostPermitido(host: string): Promise<boolean> {
  const previo = cacheHost.get(host);
  if (previo !== undefined) return previo;
  let ok = false;
  try {
    const ips = await dns.lookup(host, { all: true });
    ok = ips.length > 0 && !ips.some((r) => ipPrivada(r.address));
  } catch {
    ok = false;
  }
  if (cacheHost.size > 2000) cacheHost.clear();
  cacheHost.set(host, ok);
  return ok;
}

export async function renderizar(
  url: string,
  { soloTexto = false, desde = null }: { soloTexto?: boolean; desde?: string | null } = {}
): Promise<Vista | null> {
  if (enUso >= max()) return null; // con carga alta se usa el análisis por HTML
  const b = await abrir();
  if (!b) return null;

  enUso++;
  const ctx = await b.newContext({ locale: "es-CL", viewport: { width: 1366, height: 900 } });
  try {
    await ctx.route("**/*", async (route: any) => {
      const u = new URL(route.request().url());
      if (!["http:", "https:"].includes(u.protocol)) return route.continue();
      if (!(await hostPermitido(u.hostname))) return route.abort();
      if (soloTexto && ["image", "media", "font"].includes(route.request().resourceType())) return route.abort();
      return route.continue();
    });

    const page = await ctx.newPage();
    // "desde": abre la página de inicio y hace clic en el enlace (sitios que arman sus rutas con JavaScript)
    const resp = await page.goto(desde || url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    if (desde) {
      // Se ejecuta dentro del navegador (sin depender de los tipos DOM del backend)
      const ok = await page.evaluate((destino: string) => {
        const doc = (globalThis as any).document;
        const a = [...doc.querySelectorAll("a[href]")].find((x: any) => x.href === destino);
        if (!a) return false;
        a.removeAttribute("target");
        a.click();
        return true;
      }, url);
      if (!ok) return null;
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const estado: number = desde ? 200 : resp?.status() ?? 0;

    if (soloTexto) {
      const texto: string = await page.evaluate(() => (globalThis as any).document.body?.innerText || "");
      return { estado, texto: texto.replace(/\s+/g, " ") };
    }

    await page.waitForTimeout(1500); // scripts de analítica diferidos
    const html: string = await page.content();
    const cookies = (await ctx.cookies()).map((c: any) => ({
      nombre: c.name as string,
      origen: String(c.domain).replace(/^\./, ""),
    }));
    return { html, cookies, estado };
  } finally {
    enUso--;
    await ctx.close().catch(() => {});
  }
}

export async function cerrarNavegador(): Promise<void> {
  await navegador?.close().catch(() => {});
}
