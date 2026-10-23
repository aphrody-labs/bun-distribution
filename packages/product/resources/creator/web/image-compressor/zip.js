/* Minimal ZIP writer (store, no compression): images are already compressed. Classic script, works from file://. */
(function (root) {
  "use strict";

  var TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i += 1) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    var day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time: time, day: day };
  }

  /** files: [{ name: string, data: Uint8Array }] -> Uint8Array (a .zip). Names are UTF-8. */
  function buildZip(files, now) {
    var encoder = new TextEncoder();
    var stamp = dosDateTime(now || new Date());
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var crc = crc32(file.data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, file.data.length, true);
      local.setUint32(22, file.data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, file.data);

      var entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, stamp.time, true);
      entry.setUint16(14, stamp.day, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, file.data.length, true);
      entry.setUint32(24, file.data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + file.data.length;
    });
    var centralSize = central.reduce(function (sum, p) {
      return sum + p.length;
    }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var total = all.reduce(function (sum, p) {
      return sum + p.length;
    }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    all.forEach(function (p) {
      out.set(p, at);
      at += p.length;
    });
    return out;
  }

  var api = { crc32: crc32, buildZip: buildZip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MiniZip = api;
})(typeof self !== "undefined" ? self : this);
