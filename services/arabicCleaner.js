// Utility to clean and restore corrupted Arabic text from IBM Maximo OSLC queries and reports

const win1252Map = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

function getByte(c) {
  const code = c.charCodeAt(0);
  if (code <= 255) return code;
  return win1252Map[code] || (code & 0xff);
}

export function cleanArabicMojibake(str) {
  if (!str || typeof str !== 'string') return str;

  // Check if string contains corrupted thorn character (U+00FE / þ) or Windows-1252 Arabic mojibake
  if (!str.includes('þ') && !str.includes('\u00fe')) {
    // If it is clean Arabic, return trimmed
    return str.trim();
  }

  // 1. Map known corrupted single-byte visual replacements:
  // 'þ-' in visual RTL Arabic is 0xFEAE (Reh 'ر')
  // 'þ•' (0xFE95/FE8D) in this context is 0xFE8D (Alef 'ا')
  let s = str.replace(/þ\-/g, 'þ\u00ae');
  s = s.replace(/þ•/g, 'þ\u008d');

  let decoded = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === 'þ' || s[i] === '\u00fe') {
      if (i + 1 < s.length) {
        const nextByte = getByte(s[i + 1]);
        i++;
        decoded += String.fromCharCode(0xfe00 + nextByte);
      }
    } else {
      decoded += s[i];
    }
  }

  // 2. Normalize Unicode Presentation Forms (FE70-FEFF) to standard Arabic Unicode (0600-06FF)
  const norm = decoded.replace(/[\uFE20-\uFE2F]/g, '').normalize('NFKD');

  // 3. Split visual token sequence
  const tokens = norm.replace(/[\x00-\x1F]/g, ' ').split(/\s+/).filter(Boolean);

  // 4. Reverse the visual token sequence and reverse characters of each Arabic word
  const restored = tokens.reverse().map(token => {
    if (/[\u0600-\u06FF]/.test(token)) {
      return token.split('').reverse().join('');
    }
    return token;
  });

  return restored.join(' ').trim();
}

// Deep clean any object or array returned from Maximo
export function deepCleanMaximoData(data) {
  if (!data) return data;
  if (typeof data === 'string') {
    return cleanArabicMojibake(data);
  }
  if (Array.isArray(data)) {
    return data.map(item => deepCleanMaximoData(item));
  }
  if (typeof data === 'object') {
    const cleaned = {};
    for (const [key, val] of Object.entries(data)) {
      cleaned[key] = deepCleanMaximoData(val);
    }
    return cleaned;
  }
  return data;
}
