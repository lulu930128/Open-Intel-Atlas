const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function monthNumber(name) {
  const index = MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
  if (index < 0) throw new TypeError(`Unknown month: ${name}`);
  return index + 1;
}
export function referencePeriod(value) {
  const match = String(value).match(/\b([A-Za-z]+)\.?\s+(20\d{2})\b/);
  if (!match) throw new TypeError("Missing macro reference period");
  return `${match[2]}-${String(monthNumber(match[1])).padStart(2, "0")}`;
}
export function shiftPeriod(period, months) {
  const date = new Date(`${period}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
}
// BLS release clocks are Eastern wall time; Intl supplies DST rules.
export function easternTimestamp(dateText, timeText) {
  const date = String(dateText).match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})/);
  const time = String(timeText).match(/(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i);
  if (!date || !time) throw new TypeError("Invalid BLS release time");
  const month = monthNumber(date[1]), day = Number(date[2]), hour12 = Number(time[1]), minute = Number(time[2]);
  if (hour12 < 1 || hour12 > 12 || minute > 59 || day < 1 || day > 31) throw new TypeError("Invalid BLS clock");
  const hour = hour12 % 12 + (time[3].toLowerCase() === "p" ? 12 : 0);
  const wall = Date.UTC(Number(date[3]), month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const displayed = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (displayed === wall) {
      if (new Date(wall).getUTCMonth() !== month - 1) throw new TypeError("Invalid BLS date");
      return new Date(instant).toISOString();
    }
    instant += wall - displayed;
  }
  throw new TypeError("Unresolvable Eastern clock");
}
