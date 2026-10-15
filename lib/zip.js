const encoder = new TextEncoder();

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date words, which is how zip stores timestamps (local time, 1980 onwards, 2 s resolution). */
const dosStamp = (d) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: (Math.max(d.getFullYear(), 1980) - 1980 << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

/**
 * A zip archive (entries stored, not compressed: the files are small text) of `files`, each `{ path, content }`.
 * Paths keep their folders, so `.github/workflows/ci.yml` unpacks to where it belongs.
 */
export function zip(files, now = new Date()) {
  const { time, date } = dosStamp(now);
  const local = [];
  const central = [];
  let offset = 0;

  for (const { path, content } of files) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = crc32(data);

    // Headers share a layout: version, flags (bit 11 = UTF-8 names), method (0 = stored), time, date, crc, sizes, name length.
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, name.length, true);
    local.push(new Uint8Array(l.buffer), name, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...local, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
