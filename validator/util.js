// Small, dependency-free value helpers shared by the engine and custom checks.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
export const isPresent = (v) => !(v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.filter((x) => x !== null && x !== undefined && x !== '').length === 0));

export const isAbsUrl = (v) => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const validYmd = (y, m, d) => {
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d;
};
export const isIsoDate = (s) => { const m = DATE.exec(String(s).trim()); return !!m && validYmd(m[1], m[2], m[3]); };
export const isIsoDateTime = (s) => {
  const m = DATETIME.exec(String(s).trim());
  return !!m && validYmd(m[1], m[2], m[3]) && +m[4] < 24 && +m[5] < 60 && (m[7] === undefined || +m[7] < 60);
};
export const isIsoTime = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(String(s).trim());
export const isIsoDuration = (s) => {
  const v = String(s).trim();
  return /^P(?!$)(\d+(\.\d+)?Y)?(\d+(\.\d+)?M)?(\d+(\.\d+)?W)?(\d+(\.\d+)?D)?(T(?=\d)(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/.test(v);
};
export const hasTimezone = (s) => /(Z|[+-]\d{2}:?\d{2})$/i.test(String(s).trim());
export const parseDate = (s) => {
  if (typeof s !== 'string') return null;
  const v = s.trim();
  if (isIsoDate(v)) return new Date(`${v}T00:00:00Z`);
  if (isIsoDateTime(v)) { const d = new Date(v.replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
};
export const durationSeconds = (s) => {
  const m = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(s).trim());
  if (!m) return null;
  const [, y, mo, w, d, h, mi, se] = m.map((x) => (x ? Number(x) : 0));
  return (((y * 365 + mo * 30 + w * 7 + d) * 24 + h) * 60 + mi) * 60 + se;
};

/** Numbers, numeric strings, "4,5" decimal commas are NOT accepted (Google requires a dot). */
export const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};

export const normEnum = (v) => String(v ?? '').trim().replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');
export const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
export const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) ? text(v.name) || text(v.alternateName) : '');
