// La edge corre en UTC: una fecha/hora "local" sin zona (citas de prospecto = date + time,
// eventos de día completo de Google) se leía como UTC y salía 3 horas antes para quien la ve
// en Argentina (auditoría 05-nov, gap-01). Argentina es UTC-3 todo el año (sin horario de verano).
// JS puro para que lo testeen los tests de Node (scripts/test.mjs).
export const AR_OFFSET = "-03:00";
export function localARaISO(fecha, hhmm = "00:00") {
  return new Date(`${fecha}T${hhmm}:00${AR_OFFSET}`).toISOString();
}
