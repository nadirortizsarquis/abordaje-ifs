// Destinos permitidos para volver después del OAuth de Google (auditoría 05-nov M3: antes
// returnTo no se validaba y servía de open redirect). Compartido por init y callback.
export const RETORNO_DEFAULT = "https://universo.broker-ifs.com/";
const ORIGENES = new Set([
  "https://universo.broker-ifs.com",
  "https://abordaje.broker-ifs.com",
]);
export function retornoSeguro(raw) {
  try {
    const u = new URL(String(raw || ""));
    const local = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.protocol === "http:";
    if (!ORIGENES.has(u.origin) && !local) return RETORNO_DEFAULT;
    u.hash = "";
    return u.toString();
  } catch { return RETORNO_DEFAULT; }
}
