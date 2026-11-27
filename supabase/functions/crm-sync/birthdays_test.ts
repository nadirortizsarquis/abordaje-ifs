// Test de la op `birthdays` (deno run birthdays_test.ts).
import { birthdays, birthdaysPath } from "./birthdays.ts";
let fails = 0;
const eq = (a: unknown, b: unknown, msg: string) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fails++; console.error("FAIL", msg, "\n  got:", a, "\n  exp:", b); } else console.log("ok  ", msg);
};

// Scope
const p1 = birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", todos: true });
eq(p1, "/clients/birthdays/?days=7&advisor_email=a%40x.com&only_own=true", "no-admin: siempre con su email y only_own aunque pida todos");
eq(birthdaysPath({ isAdmin: false, advisorEmail: "" }), null, "no-admin sin email: fail-closed");
eq(birthdaysPath({ isAdmin: true, advisorEmail: "n@x.com", todos: true }), "/clients/birthdays/?days=7&advisor_email=n%40x.com", "admin + todos: con su email y sin only_own");
eq(birthdaysPath({ isAdmin: true, advisorEmail: "", todos: true }), null, "admin sin email: fail-closed también");
eq(birthdaysPath({ isAdmin: true, advisorEmail: "n@x.com" }), "/clients/birthdays/?days=7&advisor_email=n%40x.com&only_own=true", "admin por defecto: solo lo suyo");
eq(birthdaysPath({ isAdmin: true, advisorEmail: "n@x.com", todos: "true" }), "/clients/birthdays/?days=7&advisor_email=n%40x.com&only_own=true", "todos tiene que ser booleano true");

// Parámetros
eq(birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", days: 99 }), "/clients/birthdays/?days=31&advisor_email=a%40x.com&only_own=true", "days tope 31");
eq(birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", days: -3 }), "/clients/birthdays/?days=1&advisor_email=a%40x.com&only_own=true", "days mínimo 1");
eq(birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", days: "x" }), "/clients/birthdays/?days=7&advisor_email=a%40x.com&only_own=true", "days inválido -> 7");
eq(birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", start: "2026-11-27" }), "/clients/birthdays/?start=2026-11-27&days=7&advisor_email=a%40x.com&only_own=true", "start válido");
let threw = 0; try { birthdaysPath({ isAdmin: false, advisorEmail: "a@x.com", start: "27/11/2026&x=1" }); } catch (e) { threw = (e as any).status; }
eq(threw, 400, "start inválido -> 400 (sin inyección de parámetros)");

// Mapeo: no viaja email ni DNI; sin email el CRM ni se consulta.
const calls: string[] = [];
const crm = async (path: string) => {
  calls.push(path);
  return { results: [{ kind: "member", client_id: 5, member_id: 9, full_name: "Lucía Pérez", group_name: "Familia Pérez",
    birthday: "2026-11-29", age: 16, days_until: 2, phone: "+54", email: "l@x.com", document_number: "123",
    primary_advisor: { id: 1, first_name: "Nadir", last_name: "Ortiz" } }] };
};
const r = await birthdays(crm, { isAdmin: false, advisorEmail: "a@x.com" });
eq(r.items[0], { kind: "member", client_id: 5, member_id: 9, nombre: "Lucía Pérez", grupo: "Familia Pérez", cumple: "2026-11-29",
  edad: 16, en_dias: 2, telefono: "+54", asesor: "Nadir Ortiz" }, "mapeo de la tarjeta (sin email/DNI)");
const vacio = await birthdays(crm, { isAdmin: false, advisorEmail: "" });
eq([vacio.items.length, calls.length], [0, 1], "sin email: lista vacía y no consulta al CRM");

if (fails) { console.error(`${fails} test(s) fallaron`); Deno.exit(1); }
console.log("birthdays: todo ok");
