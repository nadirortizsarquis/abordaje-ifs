// Test de la verificación de propiedad de clientes del CRM (deno run ownership_test.ts).
import { clienteEsDelAsesor } from "./ownership.ts";
const err = (status: number) => Object.assign(new Error("x"), { status });
// CRM simulado: cliente 10 (doc 123, de A), 11 (sin doc, "Juan Perez", de A), 12 (doc 999, de B)
const db: Record<number, any> = {
  10: { id: 10, document_number: "12.345.678", full_name: "Ana Gomez", owner: "a@x.com" },
  11: { id: 11, document_number: "", full_name: "Juan Perez", owner: "a@x.com" },
  12: { id: 12, document_number: "999", full_name: "Otro Cliente", owner: "b@x.com" },
};
let calls: string[] = [];
const crm = async (path: string) => {
  calls.push(path);
  const m = path.match(/^\/clients\/(\d+)\/$/);
  if (m) { const c = db[+m[1]]; if (!c) throw err(404); return c; }
  const u = new URL("http://h" + path);
  const email = u.searchParams.get("advisor_email");
  const doc = u.searchParams.get("document_number"); const q = u.searchParams.get("search");
  if (u.searchParams.get("page") !== "1") throw err(404);
  const results = Object.values(db).filter((c: any) => c.owner === email && (doc ? c.document_number === doc : c.full_name.includes(q!)));
  return { count: results.length, next: null, results };
};
const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); console.log("ok ", m); };
eq(await clienteEsDelAsesor(crm, 10, "a@x.com"), true, "propio por documento (con puntos, exacto)");
eq(await clienteEsDelAsesor(crm, 11, "a@x.com"), true, "propio sin documento, por nombre");
eq(await clienteEsDelAsesor(crm, 12, "a@x.com"), false, "AJENO → false");
eq(await clienteEsDelAsesor(crm, 99, "a@x.com"), false, "inexistente → false");
eq(await clienteEsDelAsesor(crm, 10, ""), false, "sin email → false (fail-closed)");
calls = []; await clienteEsDelAsesor(crm, 12, "a@x.com");
eq(calls.every((c) => /^\/clients\/12\/$/.test(c) || c.includes("advisor_email=a%40x.com")), true, "listados SIEMPRE scopeados al asesor");
let threw = false;
try { await clienteEsDelAsesor(async () => { throw err(503); }, 10, "a@x.com"); } catch { threw = true; }
eq(threw, true, "CRM caído → propaga error (el caller no vincula ni vuelca)");
