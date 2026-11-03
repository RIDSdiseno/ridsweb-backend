// src/analizador/analisis.ts
// Revisión pública de un sitio web frente a la Ley 21.719 (Ley 19.628 modificada).
// Revisa lo que un visitante puede ver desde fuera: no reemplaza una auditoría completa.

import {
  obtener,
  certificado,
  registrosCorreo,
  hostPublico,
  normalizarDominio,
  type Pagina,
  type Certificado,
  type RegistrosCorreo,
} from "./red";
import { renderizar } from "./navegador";

// ============================================================
// TIPOS
// ============================================================

export type Estado = "ok" | "parcial" | "falla" | "revisar" | "na";

export interface Control {
  id: string;
  categoria: string;
  titulo: string;
  ley: string;
  estado: Estado;
  peso: number;
  detalle: string;
  recomendacion?: string | null;
  faltan?: string[];
}

export interface Categoria {
  nombre: string;
  total: number;
  fallas: number;
  parciales: number;
  estado: Estado;
}

interface Enlace {
  texto: string;
  url: string;
}

interface Formulario {
  action: string;
  campos: string[];
  casillas: number;
  marcadas: number;
  personales: boolean;
  mencionaPrivacidad: boolean;
}

interface Politica {
  url?: string;
  directo?: number | null;
  leida: boolean;
  palabras?: number;
  contenidos?: { nombre: string; presente: boolean }[];
  derechos?: { nombre: string; presente: boolean }[];
  mencionaLey21719?: boolean;
  soloLey19628?: boolean;
  soloGdpr?: boolean;
}

interface Servicio {
  nombre: string;
  tipo: string;
  cookies: boolean;
}

export interface Resultado {
  dominio: string;
  fecha: string;
  avisos: string[];
  sitio: { url: string; titulo: string; plataforma: string; navegador: boolean; spa: boolean };
  datos: {
    cert: Certificado;
    redir: boolean | null;
    correo: RegistrosCorreo;
    legal: Partial<Record<keyof typeof LEGALES, Enlace>>;
    politica: Politica | null;
    servicios: Servicio[];
    banner: string | null;
    cookiesAntes: { nombre: string; origen: string }[];
    forms: Formulario[];
    cabSeg: { nombre: string; presente: boolean }[];
    version: string[];
    mixto: number;
  };
  puntaje: number;
  nivel: "Bueno" | "Mejorable" | "Crítico";
  controles: Control[];
  categorias: Categoria[];
}

// ============================================================
// REGLAS DE DETECCIÓN
// ============================================================

// [nombre, patrón, tipo, instala cookies]
const SERVICIOS: [string, RegExp, string, boolean][] = [
  ["Google Analytics", /google-analytics\.com|gtag\(['"]config['"],\s*['"](G|UA)-|googletagmanager\.com\/gtag/i, "Analítica", true],
  ["Google Tag Manager", /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/, "Gestor de etiquetas", true],
  ["Píxel de Meta (Facebook)", /connect\.facebook\.net|fbq\(/i, "Publicidad", true],
  ["LinkedIn Insight", /snap\.licdn\.com|_linkedin_partner_id/i, "Publicidad", true],
  ["TikTok Pixel", /analytics\.tiktok\.com/i, "Publicidad", true],
  ["Google Ads", /googleadservices\.com|AW-\d{6,}/i, "Publicidad", true],
  ["Hotjar", /hotjar\.com/i, "Analítica", true],
  ["Microsoft Clarity", /clarity\.ms/i, "Analítica", true],
  ["HubSpot", /js\.hs-scripts\.com|hs-analytics/i, "Marketing", true],
  ["Google Maps", /google\.com\/maps\/embed|maps\.googleapis\.com/i, "Mapa de terceros", true],
  ["YouTube", /youtube\.com\/embed/i, "Video de terceros", true],
  ["Google reCAPTCHA", /google\.com\/recaptcha|recaptcha\/api/i, "Seguridad de formularios", true],
  ["Google Fonts", /fonts\.googleapis\.com/i, "Tipografías (envía la IP a Google)", false],
  ["Chat Tawk.to", /tawk\.to/i, "Chat", true],
  ["Chat JivoChat", /jivosite|jivochat/i, "Chat", true],
  ["Chat Tidio", /tidio/i, "Chat", true],
];

const BANNERS: [string, RegExp][] = [
  ["CookieYes", /cookieyes|cky-consent/i],
  ["Complianz", /complianz|cmplz/i],
  ["Cookiebot", /cookiebot/i],
  ["OneTrust", /onetrust|optanon/i],
  ["iubenda", /iubenda/i],
  ["Borlabs", /borlabs/i],
  ["Termly", /termly/i],
  ["GDPR Cookie Consent", /cookie-law-info|cookieyes/i],
  ["Cookie Notice", /cookie-notice/i],
  ["Real Cookie Banner", /real-cookie-banner/i],
  ["Wix (banner propio)", /consent-policy|cookie-consent-banner/i],
  ["Usercentrics", /usercentrics/i],
  ["Didomi", /didomi/i],
  ["Klaro", /klaro/i],
];

// Cookies que no son técnicas: no deberían instalarse antes de aceptar
const COOKIES_NO_TECNICAS =
  /^(_ga|_gid|_gat|_gcl|_fbp|_fbc|fr$|_hj|_clck|_clsk|_uet|_tt_|_ttp|li_|bcookie|lidc|IDE$|NID$|__hs|hubspot|_pin|MUID)/i;

const PLATAFORMAS: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes/i],
  ["Wix", /wixstatic|_wixCIDX/i],
  ["Shopify", /cdn\.shopify|Shopify\.theme/i],
  ["Squarespace", /squarespace/i],
  ["Webflow", /webflow/i],
  ["Joomla", /\/media\/jui\/|joomla/i],
  ["Jimdo", /jimdo/i],
  ["GoDaddy", /img1\.wsimg\.com/i],
  ["Google Sites", /sites\.google\.com/i],
  ["Next.js", /\/_next\//],
  ["React", /id="root"|data-reactroot/],
];

const CABECERAS_SEG: Record<string, string> = {
  "content-security-policy": "Content-Security-Policy",
  "x-frame-options": "X-Frame-Options",
  "x-content-type-options": "X-Content-Type-Options",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
};

// Contenidos mínimos que el art. 14 ter exige publicar
const CONTENIDOS_14TER: [string, RegExp][] = [
  ["Fecha o versión de la política", /versi[oó]n|actualizad[ao]|vigente desde|última modificaci|fecha/],
  ["Identificación del responsable (razón social o RUT)", /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dk]\b|raz[oó]n social|responsable del tratamiento|responsable de (los )?datos|s\.?p\.?a\.?|limitada|ltda/],
  ["Canal de contacto para solicitudes (correo o formulario)", /[\w.+-]+@[\w-]+\.[\w.]+|formulario de contacto/],
  ["Categorías de datos que se tratan", /categor[ií]as? de datos|datos (que )?(recopilamos|recolectamos|tratamos)|tipos? de datos|nombre.{0,40}correo/],
  ["Finalidades del tratamiento", /finalidad|prop[oó]sito|para qu[eé] (usamos|utilizamos|tratamos)/],
  ["Base de licitud (consentimiento, contrato, ley, interés legítimo)", /base (legal|de licitud|de legitimidad)|consentimiento|inter[eé]s leg[ií]timo|ejecuci[oó]n (de un|del) contrato/],
  ["Medidas de seguridad adoptadas", /medidas (t[eé]cnicas|de seguridad|organizativas)|seguridad de (la informaci|los datos)|cifrad|encriptad/],
  ["Destinatarios o terceros a quienes se comunican", /tercero|encargad|proveedor|destinatari|comunica(mos|ci[oó]n) de datos/],
  ["Transferencias internacionales", /transferencia internacional|tercer pa[ií]s|fuera de chile|extranjero|servidores ubicados/],
  ["Plazo de conservación", /conserva(r[aá]n|mos|ci[oó]n)|plazo|per[ií]odo de (retenci|almacen)/],
  ["Fuente de los datos", /fuente|proceden|obtenemos (sus|tus|los) datos|recopilad[oa]s? (a trav[eé]s|directamente|mediante|desde|en)|(nos )?proporciona(n|dos)? (directamente|por el|por usted)/],
  ["Derecho a retirar el consentimiento", /retirar (el|su|tu) consentimiento|revocar/],
  ["Derecho a reclamar ante la Agencia de Protección de Datos", /agencia de protecci[oó]n de datos/],
  ["Decisiones automatizadas y perfiles", /decisiones automatizadas|elaboraci[oó]n de perfiles|perfilamiento/],
];

const DERECHOS: [string, RegExp][] = [
  ["acceso", /\bacceso\b/],
  ["rectificación", /rectificaci/],
  ["supresión", /supresi[oó]n|eliminaci[oó]n|cancelaci[oó]n/],
  ["oposición", /oposici[oó]n/],
  ["bloqueo", /bloqueo/],
  ["portabilidad", /portabilidad/],
];

const LEGALES = {
  privacidad: /privacidad|privacy|datos personales|protecci[oó]n de datos/i,
  cookies: /cookie/i,
  aviso: /aviso legal|t[eé]rminos|condiciones de uso|condiciones generales/i,
};

const CAMPOS_PERSONALES = /mail|correo|tel|fono|phone|celular|nombre|name|rut|direcci|address|apellido|empresa/i;

// ============================================================
// UTILIDADES
// ============================================================

const texto = (html: string | null | undefined): string =>
  (html || "")
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const palabras = (t: string) => t.split(" ").length;

function enlaces(html: string, base: string): Enlace[] {
  const out: Enlace[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      out.push({ texto: texto(m[2]).slice(0, 80), url: new URL(href, base).toString() });
    } catch {
      /* href roto */
    }
  }
  return out;
}

function formularios(html: string): Formulario[] {
  const out: Formulario[] = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const action = m[1].match(/action\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const campos: string[] = [];
    let casillas = 0;
    let marcadas = 0;

    for (const c of m[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const at = c[2];
      const tipo = (at.match(/type\s*=\s*["']?([\w-]+)/i)?.[1] || c[1]).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(tipo)) continue;
      if (tipo === "checkbox") {
        casillas++;
        if (/\bchecked\b/i.test(at)) marcadas++;
        continue;
      }
      const nombre = at.match(/(?:name|placeholder|aria-label|id)\s*=\s*["']([^"']+)["']/i)?.[1] || tipo;
      campos.push(`${nombre}|${tipo}`);
    }

    const t = texto(m[2]).toLowerCase();
    if (campos.length) {
      out.push({
        action,
        campos,
        casillas,
        marcadas,
        personales: campos.some((c) => CAMPOS_PERSONALES.test(c) || /\|(email|tel)$/.test(c)),
        mencionaPrivacidad: /privacidad|datos personales|pol[ií]tica/.test(t),
      });
    }
  }
  return out.slice(0, 8);
}

function evaluarPolitica(t: string): Politica {
  const x = t.toLowerCase();
  if (palabras(x) < 150) return { leida: false };
  return {
    leida: true,
    palabras: palabras(x),
    contenidos: CONTENIDOS_14TER.map(([nombre, re]) => ({ nombre, presente: re.test(x) })),
    derechos: DERECHOS.map(([nombre, re]) => ({ nombre, presente: re.test(x) })),
    mencionaLey21719: /21\.?719/.test(x),
    soloLey19628: /19\.?628/.test(x) && !/21\.?719/.test(x),
    soloGdpr: /\bgdpr\b|rgpd|reglamento general de protecci/.test(x) && !/21\.?719|19\.?628/.test(x),
  };
}

// Los controles se arman con objetos parciales; los valores por omisión van aquí
const item = (o: Record<string, unknown>): Control =>
  ({ estado: "revisar", peso: 1, ...o }) as Control;

// ============================================================
// SITIOS QUE SE ARMAN CON JAVASCRIPT (React, Vue, Angular…)
// ============================================================
// Sin navegador, el HTML de estas páginas llega casi vacío (<div id="root">).
// Para no dar falsos "No cumple", se descargan los archivos JavaScript del propio
// sitio (con los mismos límites de tamaño y seguridad) y se busca en ellos lo que
// el navegador terminaría mostrando. No ejecuta código: solo lee texto.

interface InfoSpa {
  codigo: string;                  // texto de los scripts (se descarta al terminar el análisis)
  rutas: string[];                 // rutas internas encontradas ("/politica-privacidad", …)
  bannerPropio: boolean;           // textos de un aviso de cookies
  formulario: { campos: boolean; casillaPrivacidad: boolean };
  archivos: number;
}

const MAX_SCRIPTS = 6;
const MAX_CODIGO = 8 * 1024 * 1024; // 8 MB en total

const esPaginaSpa = (html: string) =>
  palabras(texto(html)) < 60 &&
  /<script\b[^>]*\bsrc\s*=/i.test(html) &&
  /id=["'](root|app|__next|__nuxt)["']|<app-root|ng-version|data-reactroot/i.test(html);

function scriptsDelSitio(html: string, base: string, dominio: string): string[] {
  const urls = new Set<string>();
  const re = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+\.m?js(?:\?[^"']*)?)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      const h = u.hostname.replace(/^www\./, "");
      if (h === dominio || h.endsWith("." + dominio)) urls.add(u.toString());
    } catch {
      /* ruta rota */
    }
  }
  return [...urls].slice(0, MAX_SCRIPTS);
}

async function revisarCodigoSpa(html: string, base: string, dominio: string): Promise<InfoSpa | null> {
  const pendientes = scriptsDelSitio(html, base, dominio);
  if (!pendientes.length) return null;

  const vistos = new Set<string>();
  let codigo = "";
  let archivos = 0;

  while (pendientes.length && archivos < MAX_SCRIPTS && codigo.length < MAX_CODIGO) {
    const url = pendientes.shift() as string;
    if (vistos.has(url)) continue;
    vistos.add(url);
    try {
      const p = await obtener(url, { timeout: 10000 });
      if (p.status >= 400) continue;
      codigo += "\n" + p.html.slice(0, MAX_CODIGO - codigo.length);
      archivos++;

      // Páginas cargadas por separado (React.lazy): se siguen solo las que suenan a legales
      for (const c of p.html.matchAll(/["'`]([^"'`\s]*?(?:privac|cookie|legal|aviso|termin|condicion)[^"'`\s]*?\.m?js)["'`]/gi)) {
        try {
          const u = new URL(c[1], url).toString();
          if (!vistos.has(u) && new URL(u).hostname.replace(/^www\./, "").endsWith(dominio)) pendientes.push(u);
        } catch {
          /* ruta rota */
        }
      }
    } catch {
      /* script inaccesible: se ignora */
    }
  }
  if (!codigo) return null;

  // Los empaquetadores escriben los acentos como \xED o \u00ED: se decodifican para poder buscar textos
  codigo = codigo
    .replace(/\\x([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

  // Rutas internas escritas en el código: path:"/politica-privacidad", to:"/cookies", href:"/aviso-legal"…
  const rutas = new Set<string>();
  for (const m of codigo.matchAll(/["'`](\/[a-z0-9][a-z0-9\-_/]{2,80})["'`]/gi)) {
    const ruta = m[1].replace(/\/+$/, "");
    if (/^\/(assets|static|_next|node_modules|src)\//i.test(ruta)) continue;
    if (/\.[a-z0-9]{2,4}$/i.test(ruta)) continue;
    rutas.add(ruta);
  }

  // Textos de un aviso de cookies propio (dentro de una misma cadena de texto)
  const bannerPropio =
    /cookies?[^"'`]{0,240}(aceptar|acepto|rechazar|configurar|preferencias)|(aceptar|acepto|rechazar)[^"'`]{0,240}cookies?/i.test(codigo);

  // Formularios armados con JavaScript (JSX compilado: type:"email")
  const campos = /type\s*:\s*["'](email|tel)["']/i.test(codigo);
  // Casilla cerca de un texto de privacidad (ej. "He leído la Política de Privacidad")
  const casillaPrivacidad =
    /type\s*:\s*["']checkbox["'][\s\S]{0,600}(privacidad|privacy)|(privacidad|privacy)[\s\S]{0,600}type\s*:\s*["']checkbox["']/i.test(codigo);

  return { codigo, rutas: [...rutas], bannerPropio, formulario: { campos, casillaPrivacidad }, archivos };
}

// ============================================================
// ANÁLISIS
// ============================================================

export async function analizarSitio(
  entrada: string,
  { alAvanzar = (_paso: string) => { } }: { alAvanzar?: (paso: string) => void } = {}
): Promise<Resultado> {
  const dominio = normalizarDominio(entrada);
  await hostPublico(dominio);
  const r = { dominio, fecha: new Date().toISOString(), avisos: [] as string[] } as Resultado;

  alAvanzar("Conectando con el sitio");
  let pag: Pagina | null = null;
  for (const u of [`https://${dominio}`, `https://www.${dominio}`, `http://${dominio}`]) {
    try {
      pag = await obtener(u);
      break;
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      r.avisos.push(`${u}: ${err.cause?.code || err.message}`);
    }
  }
  if (!pag) {
    const e = new Error(`No pudimos abrir ${dominio}. Revise que el sitio esté en línea.`) as Error & { usuario?: boolean };
    e.usuario = true;
    throw e;
  }

  const urlFinal = pag.url;
  const host = new URL(urlFinal).hostname;
  const https = urlFinal.startsWith("https://");

  alAvanzar("Revisando seguridad y certificado");
  const [cert, redir, correo] = await Promise.all([
    https ? certificado(host) : Promise.resolve<Certificado>({ valido: false, error: "El sitio no usa HTTPS" }),
    obtener(`http://${host}`).then((p) => p.url.startsWith("https://")).catch(() => null),
    registrosCorreo(dominio),
  ]);

  alAvanzar("Cargando el sitio como un visitante (sin aceptar cookies)");
  let html = pag.html;
  let cookiesAntes = pag.cookies.map((n) => ({ nombre: n, origen: host }));
  let navegador = false;
  const vista = await renderizar(urlFinal).catch((e: Error) => {
    r.avisos.push(`navegador: ${e.message}`);
    return null;
  });
  if (vista?.html) {
    html = vista.html;
    cookiesAntes = vista.cookies || [];
    navegador = true;
  } else if (palabras(texto(html)) < 60) {
    r.avisos.push("El sitio arma su contenido con JavaScript y se revisó solo el HTML inicial.");
  }

  // Sitio armado con JavaScript y sin navegador: se lee su código
  let spa: InfoSpa | null = null;
  if (!navegador && esPaginaSpa(html)) {
    spa = await revisarCodigoSpa(html, urlFinal, dominio).catch(() => null);
    if (spa) {
      r.avisos.pop();
      r.avisos.push(`El sitio arma su contenido con JavaScript: se revisaron ${spa.archivos} archivo(s) de su código.`);
    }
  }
  const codigoSpa = spa?.codigo || "";

  const cab: Record<string, string> = {};
  pag.headers.forEach((v: string, k: string) => {
    cab[k.toLowerCase()] = v;
  });

  const lks = enlaces(html, urlFinal).filter((l) => {
    try {
      const h = new URL(l.url).hostname.replace(/^www\./, "");
      return h === dominio || h.endsWith("." + dominio);
    } catch {
      return false;
    }
  });

  const legal: Resultado["datos"]["legal"] = {};
  for (const [k, re] of Object.entries(LEGALES) as [keyof typeof LEGALES, RegExp][]) {
    let url = "";
    const l = lks.find((x) => {
      try {
        url = decodeURIComponent(x.url);
      } catch {
        url = x.url;
      }
      return re.test(`${x.texto} ${url}`);
    });
    if (l) legal[k] = l;
  }
  // En sitios armados con JavaScript, las rutas legales se buscan en su código
  if (spa) {
    const prefer: Record<keyof typeof LEGALES, RegExp> = {
      privacidad: /privacidad|privacy/i,
      cookies: /cookie/i,
      aviso: /aviso-legal|terminos|t%C3%A9rminos|condiciones|legal/i,
    };
    for (const k of Object.keys(LEGALES) as (keyof typeof LEGALES)[]) {
      if (legal[k]) continue;
      const ruta =
        spa.rutas.find((x) => prefer[k].test(x)) ||
        spa.rutas.find((x) => LEGALES[k].test(x.replace(/[-_]/g, " ")));
      if (ruta) legal[k] = { texto: "código del sitio", url: new URL(ruta, urlFinal).toString() };
    }
  }

  if (
    legal.cookies && legal.privacidad &&
    legal.cookies.url === legal.privacidad.url &&
    !/cookie/i.test(legal.privacidad.texto)
  ) {
    delete legal.cookies;
  }

  alAvanzar("Leyendo la política de privacidad");
  let politica: Politica | null = null;
  if (legal.privacidad) {
    const u = legal.privacidad.url;
    try {
      let t = "";
      let directo: number | null = null;
      try {
        const p = await obtener(u);
        directo = p.status;
        t = p.status < 400 ? texto(p.html) : "";
      } catch {
        /* sin respuesta */
      }
      if (navegador && palabras(t) < 150) {
        const v = await renderizar(u, { soloTexto: true }).catch(() => null);
        if (v && v.estado < 400 && v.texto) t = v.texto;
        if (palabras(t) < 150) {
          t = (await renderizar(u, { soloTexto: true, desde: urlFinal }).catch(() => null))?.texto || t;
        }
      }
      politica = { url: u, directo, ...evaluarPolitica(t) };
    } catch {
      politica = { url: u, leida: false };
    }
  }

  const servicios: Servicio[] = SERVICIOS
    .filter(([, re]) => re.test(html) || (codigoSpa !== "" && re.test(codigoSpa)))
    .map(([nombre, , tipo, cookies]) => ({ nombre, tipo, cookies }));
  const rastreadores = servicios.filter((s) => s.cookies && !/Seguridad/.test(s.tipo));

  const textoInicio = texto(html);
  const banner =
    BANNERS.find(([, re]) => re.test(html) || (codigoSpa !== "" && re.test(codigoSpa)))?.[0] ||
    ((/cookie/i.test(textoInicio) && /(aceptar|acepto|rechazar|configurar|preferencias)/i.test(textoInicio)) || spa?.bannerPropio
      ? "Aviso de cookies propio"
      : null);

  const cookiesNoTecnicas = cookiesAntes.filter((c) => COOKIES_NO_TECNICAS.test(c.nombre));
  const forms = formularios(html);
  const formsPersonales = forms.filter((f) => f.personales);
  const cabSeg = Object.entries(CABECERAS_SEG).map(([k, nombre]) => ({ nombre, presente: k in cab }));

  const version = ["server", "x-powered-by"]
    .filter((k) => cab[k] && /\d/.test(cab[k]))
    .map((k) => `${k}: ${cab[k]}`);
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1];
  if (gen && /\d/.test(gen)) version.push(`generator: ${gen.slice(0, 60)}`);

  const mixto = https
    ? (html.match(/(?:src|href)=["']http:\/\/(?!localhost)[^"']+\.(?:js|css|png|jpe?g|gif|svg|webp)/gi) || []).length
    : 0;

  r.sitio = {
    url: urlFinal,
    titulo: texto(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 120),
    plataforma: PLATAFORMAS.find(([, re]) => re.test(html))?.[0] || "No identificada",
    navegador,
    spa: Boolean(spa),
  };
  r.datos = { cert, redir, correo, legal, politica, servicios, banner, cookiesAntes, forms, cabSeg, version, mixto };

  // ---------------- Controles ----------------
  const C: Control[] = [];
  const A = "Transparencia e información";
  const B = "Cookies y consentimiento";
  const F = "Formularios";
  const S = "Seguridad del sitio";
  const M = "Correo y suplantación";

  // Transparencia
  C.push(item({
    id: "politica", categoria: A, peso: 3, ley: "Art. 14 ter",
    titulo: "Política de privacidad publicada",
    ...(legal.privacidad && politica?.directo != null && politica.directo >= 400
      ? {
        estado: "parcial",
        detalle: `El enlace ${legal.privacidad.url} responde error ${politica.directo} al abrirlo directamente (solo funciona navegando desde el inicio).`,
        recomendacion: "Configure el servidor para que la dirección de la política abra directamente; se comparte por correo y la indexan los buscadores.",
      }
      : legal.privacidad
        ? {
          estado: "ok",
          detalle: `Encontrada: ${legal.privacidad.url}${legal.privacidad.texto === "código del sitio" ? " (detectada en el código del sitio)" : ""}`,
        }
        : {
          estado: "falla",
          detalle: spa
            ? "No encontramos una política de privacidad ni en la página de inicio ni en el código del sitio."
            : "No encontramos un enlace a la política de privacidad en la página de inicio.",
          recomendacion: "Publique una política de tratamiento de datos personales y enlácela en el pie de todas las páginas.",
        }),
  }));

  if (politica?.leida && politica.contenidos && politica.derechos) {
    const faltan = politica.contenidos.filter((c) => !c.presente).map((c) => c.nombre);
    const n = politica.contenidos.length;
    C.push(item({
      id: "contenidos", categoria: A, peso: 4, ley: "Art. 14 ter",
      titulo: "Contenidos mínimos de la política",
      estado: faltan.length === 0 ? "ok" : faltan.length <= 3 ? "parcial" : "falla",
      detalle: `Incluye ${n - faltan.length} de ${n} contenidos mínimos.`,
      faltan,
      recomendacion: faltan.length ? "Complete la política con los contenidos que exige el art. 14 ter." : null,
    }));

    const sinDer = politica.derechos.filter((d) => !d.presente).map((d) => d.nombre);
    C.push(item({
      id: "derechos", categoria: A, peso: 3, ley: "Arts. 5 a 9",
      titulo: "Derechos de los titulares",
      estado: sinDer.length === 0 ? "ok" : sinDer.length <= 2 ? "parcial" : "falla",
      detalle: sinDer.length
        ? `No menciona: ${sinDer.join(", ")}.`
        : "Menciona acceso, rectificación, supresión, oposición, bloqueo y portabilidad.",
      recomendacion: sinDer.length
        ? "Explique cada derecho y cómo ejercerlo (incluye bloqueo y portabilidad, nuevos con la Ley 21.719)."
        : null,
    }));

    C.push(item({
      id: "ley", categoria: A, peso: 2, ley: "Ley 21.719",
      titulo: "Política actualizada a la Ley 21.719",
      estado: politica.mencionaLey21719 ? "ok" : "falla",
      detalle: politica.mencionaLey21719
        ? "La política cita la Ley 21.719."
        : politica.soloGdpr
          ? "La política está redactada para el reglamento europeo (GDPR), no para la ley chilena."
          : politica.soloLey19628
            ? "La política cita solo la Ley 19.628 sin las modificaciones de la Ley 21.719."
            : "La política no cita la Ley 21.719.",
      recomendacion: politica.mencionaLey21719
        ? null
        : "Actualice la política a la Ley 21.719, que rige desde el 1 de diciembre de 2026.",
    }));
  } else if (legal.privacidad) {
    C.push(item({
      id: "contenidos", categoria: A, peso: 4, ley: "Art. 14 ter", estado: "revisar",
      titulo: "Contenidos mínimos de la política",
      detalle: spa
        ? "La política existe, pero el sitio la muestra con JavaScript y no pudimos leer su texto para revisar los contenidos mínimos."
        : "No pudimos leer el texto de la política (es un PDF, una imagen o se carga con JavaScript).",
      recomendacion: spa
        ? "Revise que la política incluya los 14 contenidos del art. 14 ter y publíquela como HTML que se lea sin JavaScript (prerenderizada)."
        : "Publique la política como texto en una página del sitio.",
    }));
  }

  C.push(item({
    id: "aviso", categoria: A, peso: 1, ley: "Art. 14 ter",
    titulo: "Términos de uso o aviso legal",
    ...(legal.aviso
      ? { estado: "ok", detalle: `Encontrado: ${legal.aviso.url}` }
      : {
        estado: "parcial",
        detalle: "No encontramos términos de uso ni aviso legal.",
        recomendacion: "Publique un aviso legal que identifique a la empresa (razón social, RUT y domicilio).",
      }),
  }));

  // Cookies
  C.push(item({
    id: "banner", categoria: B, peso: 3, ley: "Art. 12",
    titulo: "Aviso y consentimiento de cookies",
    ...(rastreadores.length === 0 && cookiesNoTecnicas.length === 0
      ? {
        estado: banner ? "ok" : "na",
        detalle: banner ? `Tiene aviso de cookies (${banner}).` : "No detectamos herramientas que requieran consentimiento.",
      }
      : banner
        ? { estado: "ok", detalle: `Tiene aviso de cookies (${banner}).` }
        : {
          estado: "falla",
          detalle: `Usa ${rastreadores.map((s) => s.nombre).join(", ") || "cookies no técnicas"} sin un aviso de consentimiento.`,
          recomendacion: "Instale un gestor de consentimiento que bloquee la analítica y la publicidad hasta que el visitante acepte.",
        }),
  }));

  C.push(item({
    id: "cookies_previas", categoria: B, peso: 3, ley: "Art. 12",
    titulo: "Cookies instaladas antes de aceptar",
    ...(cookiesNoTecnicas.length
      ? {
        estado: "falla",
        detalle: `Al entrar, sin aceptar nada, se instalan: ${[...new Set(cookiesNoTecnicas.map((c) => c.nombre))].slice(0, 8).join(", ")}.`,
        recomendacion: "Configure el sitio para que la analítica y la publicidad se activen solo después del consentimiento.",
      }
      : navegador
        ? { estado: "ok", detalle: "No se instalan cookies de analítica ni publicidad antes de aceptar." }
        : rastreadores.length
          ? {
            estado: "revisar",
            detalle: "El sitio carga herramientas que suelen instalar cookies; confirme en el navegador que esperan el consentimiento.",
          }
          : { estado: "ok", detalle: "No detectamos cookies de analítica ni publicidad." }),
  }));

  C.push(item({
    id: "politica_cookies", categoria: B, peso: 1, ley: "Art. 14 ter",
    titulo: "Política de cookies",
    ...(legal.cookies
      ? { estado: "ok", detalle: `Encontrada: ${legal.cookies.url}` }
      : rastreadores.length || cookiesNoTecnicas.length
        ? {
          estado: "parcial",
          detalle: "No encontramos una política de cookies.",
          recomendacion: "Publique qué cookies usa el sitio, para qué y por cuánto tiempo.",
        }
        : { estado: "na", detalle: "No se requiere si el sitio no usa cookies propias de analítica o publicidad." }),
  }));

  // Formularios
  if (formsPersonales.length) {
    const sinAviso = formsPersonales.filter((f) => !f.mencionaPrivacidad && f.casillas === 0);
    const premarcadas = formsPersonales.filter((f) => f.marcadas > 0);

    C.push(item({
      id: "form_aviso", categoria: F, peso: 3, ley: "Arts. 12 y 14 ter",
      titulo: "Aviso de privacidad en formularios",
      estado: sinAviso.length === 0 ? "ok" : sinAviso.length < formsPersonales.length ? "parcial" : "falla",
      detalle: `${formsPersonales.length} formulario(s) piden datos personales; ${sinAviso.length} no informan para qué se usan ni enlazan la política.`,
      recomendacion: sinAviso.length
        ? "Agregue junto al botón de envío un texto breve con la finalidad y un enlace a la política (y una casilla si los datos se usarán para marketing)."
        : null,
    }));

    C.push(item({
      id: "form_marcadas", categoria: F, peso: 2, ley: "Art. 12",
      titulo: "Casillas de consentimiento sin marcar",
      estado: premarcadas.length ? "falla" : "ok",
      detalle: premarcadas.length ? "Hay casillas de aceptación marcadas de antemano." : "No hay casillas marcadas de antemano.",
      recomendacion: premarcadas.length
        ? "El consentimiento debe ser una acción del visitante: deje las casillas sin marcar."
        : null,
    }));

    const inseguros = formsPersonales.filter(
      (f) => f.action.startsWith("http://") || (!https && !f.action.startsWith("https://"))
    );
    C.push(item({
      id: "form_cifrado", categoria: F, peso: 3, ley: "Art. 14 quinquies",
      titulo: "Envío cifrado de formularios",
      estado: inseguros.length ? "falla" : "ok",
      detalle: inseguros.length ? "Hay formularios que envían los datos sin cifrar (http)." : "Los formularios envían los datos por HTTPS.",
      recomendacion: inseguros.length ? "Envíe todos los formularios por HTTPS." : null,
    }));
  } else if (spa?.formulario.campos) {
    // Formularios armados con JavaScript: se deduce del código si hay casilla de privacidad
    C.push(item({
      id: "form_aviso", categoria: F, peso: 3, ley: "Arts. 12 y 14 ter",
      titulo: "Aviso de privacidad en formularios",
      ...(spa.formulario.casillaPrivacidad
        ? {
          estado: "ok",
          detalle: "El sitio arma sus formularios con JavaScript; en su código hay campos de correo o teléfono junto a una casilla que menciona la política de privacidad.",
        }
        : {
          estado: "revisar",
          detalle: "El sitio arma sus formularios con JavaScript y pide correo o teléfono; no encontramos en su código una casilla o aviso de privacidad.",
          recomendacion: "Agregue junto al botón de envío un texto breve con la finalidad y un enlace a la política (y una casilla si los datos se usarán para marketing).",
        }),
    }));
  } else {
    C.push(item({
      id: "form_aviso", categoria: F, peso: 0, ley: "Arts. 12 y 14 ter",
      titulo: "Formularios con datos personales",
      estado: "na",
      detalle: navegador
        ? "No encontramos formularios que pidan datos personales en la página de inicio."
        : "No encontramos formularios en el HTML de la página de inicio.",
    }));
  }

  // Seguridad
  const dias = cert.diasRestantes ?? 0;
  C.push(item({
    id: "https", categoria: S, peso: 3, ley: "Art. 14 quinquies",
    titulo: "Conexión cifrada (HTTPS)",
    ...(https && cert.valido
      ? {
        estado: dias < 15 ? "parcial" : "ok",
        detalle: `Certificado válido emitido por ${cert.emisor || "—"}, vence el ${cert.vence} (${dias} días).`,
        recomendacion: dias < 15 ? "Renueve el certificado SSL o active la renovación automática." : null,
      }
      : {
        estado: "falla",
        detalle: https ? cert.error : "El sitio no usa HTTPS.",
        recomendacion: "Instale un certificado SSL válido y sirva todo el sitio por HTTPS.",
      }),
  }));

  const hsts = "strict-transport-security" in cab;
  C.push(item({
    id: "redir", categoria: S, peso: 1, ley: "Art. 14 quinquies",
    titulo: "Redirección de http a https y HSTS",
    estado: redir && hsts ? "ok" : redir ? "parcial" : "falla",
    detalle: `${redir ? "Redirige" : "No redirige"} de http a https; ${hsts ? "con" : "sin"} cabecera HSTS.`,
    recomendacion: redir && hsts ? null : "Redirija todo el tráfico a https y active HSTS.",
  }));

  const nCab = cabSeg.filter((c) => c.presente).length;
  C.push(item({
    id: "cabeceras", categoria: S, peso: 2, ley: "Art. 14 quinquies",
    titulo: "Cabeceras de seguridad",
    estado: nCab >= 4 ? "ok" : nCab >= 2 ? "parcial" : "falla",
    detalle: `Tiene ${nCab} de 5. Faltan: ${cabSeg.filter((c) => !c.presente).map((c) => c.nombre).join(", ") || "ninguna"}.`,
    recomendacion: nCab >= 4 ? null : "Configure en el servidor las cabeceras de seguridad que faltan.",
  }));

  C.push(item({
    id: "version", categoria: S, peso: 1, ley: "Art. 14 quinquies",
    titulo: "Versiones de software ocultas",
    estado: version.length ? "parcial" : "ok",
    detalle: version.length ? `El sitio muestra versiones: ${version.join("; ")}.` : "El sitio no muestra versiones de su software.",
    recomendacion: version.length
      ? "Oculte las versiones del servidor y del gestor de contenidos; facilitan ataques conocidos."
      : null,
  }));

  if (mixto) {
    C.push(item({
      id: "mixto", categoria: S, peso: 1, ley: "Art. 14 quinquies",
      titulo: "Contenido mixto",
      estado: "parcial",
      detalle: `${mixto} recurso(s) se cargan por http dentro de una página https.`,
      recomendacion: "Cargue todos los recursos por https.",
    }));
  }

  // Correo
  if (correo.mx.length) {
    const spfOk = Boolean(correo.spf && /[~-]all\b/.test(correo.spf));
    C.push(item({
      id: "spf", categoria: M, peso: 1, ley: "Art. 14 quinquies",
      titulo: "Registro SPF del dominio",
      estado: correo.spf ? (spfOk ? "ok" : "parcial") : "falla",
      detalle: correo.spf ? `SPF: ${correo.spf.slice(0, 120)}` : "El dominio no tiene registro SPF.",
      recomendacion: spfOk ? null : "Publique un registro SPF que termine en -all o ~all.",
    }));

    C.push(item({
      id: "dmarc", categoria: M, peso: 2, ley: "Art. 14 quinquies",
      titulo: "Protección contra suplantación (DMARC)",
      estado: !correo.dmarc ? "falla" : correo.dmarcPolitica === "none" ? "parcial" : "ok",
      detalle: !correo.dmarc
        ? "El dominio no tiene DMARC: cualquiera puede enviar correos haciéndose pasar por la empresa."
        : `DMARC con política "${correo.dmarcPolitica}".`,
      recomendacion: !correo.dmarc || correo.dmarcPolitica === "none"
        ? "Configure DMARC con política quarantine o reject."
        : null,
    }));
  }

  // ---------------- Puntaje ----------------
  const valor: Record<Exclude<Estado, "na">, number> = { ok: 1, parcial: 0.5, falla: 0, revisar: 0.5 };
  let tot = 0;
  let sum = 0;
  for (const c of C) {
    if (c.estado !== "na" && c.peso) {
      tot += c.peso;
      sum += c.peso * valor[c.estado];
    }
  }

  r.puntaje = tot ? Math.round((sum / tot) * 100) : 0;
  r.nivel = r.puntaje >= 80 ? "Bueno" : r.puntaje >= 55 ? "Mejorable" : "Crítico";
  r.controles = C;
  r.categorias = [A, B, F, S, M]
    .map((nombre): Categoria => {
      const cs = C.filter((c) => c.categoria === nombre && c.estado !== "na");
      const fallas = cs.filter((c) => c.estado === "falla").length;
      const parciales = cs.filter((c) => c.estado === "parcial" || c.estado === "revisar").length;
      return {
        nombre,
        total: cs.length,
        fallas,
        parciales,
        estado: !cs.length ? "na" : fallas ? "falla" : parciales ? "parcial" : "ok",
      };
    })
    .filter((c) => c.total);

  return r;
}
