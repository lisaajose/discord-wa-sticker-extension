/**
 * zipExporter.js — ZIP File Creator for Sticker Packs
 *
 * Creates ZIP files containing multiple WebP stickers for batch export.
 * Uses a minimal built-in ZIP implementation (no external dependencies).
 *
 * ZIP contents:
 * sticker_1.webp
 * sticker_2.webp
 * sticker_3.webp
 * ...
 */

// ============================================================
// ZIP Exporter Class
// ============================================================
class ZipExporter {
  constructor() {
    this.files = [];
  }

  /**
   * Add a file to the ZIP
   * @param {string} filename - Name of the file in the ZIP
   * @param {Blob|ArrayBuffer|Uint8Array} data - File data
   */
  async addFile(filename, data) {
    let uint8;
    if (data instanceof Blob) {
      const ab = await data.arrayBuffer();
      uint8 = new Uint8Array(ab);
    } else if (data instanceof ArrayBuffer) {
      uint8 = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      uint8 = data;
    } else {
      throw new Error('Unsupported data type. Use Blob, ArrayBuffer, or Uint8Array.');
    }

    this.files.push({
      name: filename,
      data: uint8
    });
  }

  /**
   * Generate the ZIP file as a Blob
   * @returns {Promise<Blob>} The ZIP file blob
   */
  async generate() {
    const entries = [];
    let offset = 0;

    // Build local file headers and accumulate data
    for (const file of this.files) {
      const nameBytes = new TextEncoder().encode(file.name);
      const crc = ZipExporter.crc32(file.data);

      // Local file header
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hView = new DataView(header);
      hView.setUint32(0, 0x04034b50, true);     // Signature
      hView.setUint16(4, 20, true);              // Version needed (2.0)
      hView.setUint16(6, 0, true);               // Flags
      hView.setUint16(8, 0, true);               // Compression: STORE
      hView.setUint16(10, 0, true);              // Mod time
      hView.setUint16(12, 0, true);              // Mod date
      hView.setUint32(14, crc, true);            // CRC-32
      hView.setUint32(18, file.data.length, true); // Compressed size
      hView.setUint32(22, file.data.length, true); // Uncompressed size
      hView.setUint16(26, nameBytes.length, true); // Filename length
      hView.setUint16(28, 0, true);              // Extra field length
      new Uint8Array(header).set(nameBytes, 30);

      entries.push({
        header: new Uint8Array(header),
        data: file.data,
        nameBytes,
        crc,
        offset
      });

      offset += header.byteLength + file.data.length;
    }

    // Build central directory
    const centralDirEntries = [];
    for (const entry of entries) {
      const cd = new ArrayBuffer(46 + entry.nameBytes.length);
      const cdView = new DataView(cd);
      cdView.setUint32(0, 0x02014b50, true);       // Central directory signature
      cdView.setUint16(4, 20, true);                // Version made by
      cdView.setUint16(6, 20, true);                // Version needed
      cdView.setUint16(8, 0, true);                 // Flags
      cdView.setUint16(10, 0, true);                // Compression: STORE
      cdView.setUint16(12, 0, true);                // Mod time
      cdView.setUint16(14, 0, true);                // Mod date
      cdView.setUint32(16, entry.crc, true);        // CRC-32
      cdView.setUint32(20, entry.data.length, true);// Compressed size
      cdView.setUint32(24, entry.data.length, true);// Uncompressed size
      cdView.setUint16(28, entry.nameBytes.length, true); // Filename length
      cdView.setUint16(30, 0, true);                // Extra field length
      cdView.setUint16(32, 0, true);                // Comment length
      cdView.setUint16(34, 0, true);                // Disk number
      cdView.setUint16(36, 0, true);                // Internal attrs
      cdView.setUint32(38, 0, true);                // External attrs
      cdView.setUint32(42, entry.offset, true);     // Local header offset
      new Uint8Array(cd).set(entry.nameBytes, 46);
      centralDirEntries.push(new Uint8Array(cd));
    }

    const centralDirSize = centralDirEntries.reduce((s, cd) => s + cd.length, 0);

    // End of Central Directory Record
    const eocd = new ArrayBuffer(22);
    const eocdView = new DataView(eocd);
    eocdView.setUint32(0, 0x06054b50, true);        // EOCD signature
    eocdView.setUint16(4, 0, true);                  // Disk number
    eocdView.setUint16(6, 0, true);                  // Disk with CD
    eocdView.setUint16(8, entries.length, true);      // Entries on disk
    eocdView.setUint16(10, entries.length, true);     // Total entries
    eocdView.setUint32(12, centralDirSize, true);     // CD size
    eocdView.setUint32(16, offset, true);             // CD offset
    eocdView.setUint16(20, 0, true);                  // Comment length

    // Combine everything
    const parts = [];
    for (const entry of entries) {
      parts.push(entry.header);
      parts.push(entry.data);
    }
    for (const cd of centralDirEntries) {
      parts.push(cd);
    }
    parts.push(new Uint8Array(eocd));

    const totalSize = parts.reduce((s, p) => s + p.length, 0);
    const result = new Uint8Array(totalSize);
    let pos = 0;
    for (const part of parts) {
      result.set(part, pos);
      pos += part.length;
    }

    return new Blob([result], { type: 'application/zip' });
  }

  /**
   * Clear all files from the exporter
   */
  clear() {
    this.files = [];
  }

  /**
   * Get the number of files currently added
   * @returns {number}
   */
  get fileCount() {
    return this.files.length;
  }

  // ============================================================
  // CRC-32 Implementation
  // ============================================================
  static crc32(data) {
    const table = ZipExporter._getCRC32Table();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  static _crc32Table = null;

  static _getCRC32Table() {
    if (ZipExporter._crc32Table) return ZipExporter._crc32Table;
    ZipExporter._crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      ZipExporter._crc32Table[i] = c;
    }
    return ZipExporter._crc32Table;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZipExporter;
}
