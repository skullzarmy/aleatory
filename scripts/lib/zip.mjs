import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";

/**
 * A ZIP writer, in about eighty lines and no dependency.
 *
 * Adding a package to produce three small archives would put a supply chain in
 * front of the thing artists download from us, which is a poor trade for a
 * format whose entire specification here is two headers and a trailer.
 */

// node:zlib gained crc32 in 20.12. Fall back rather than require a version.
const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    if (typeof nodeCrc32 === "function") return nodeCrc32(buf) >>> 0;
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name: string, data: Buffer | string}[]} files
 * @returns {Buffer}
 */
export function zip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    // A fixed timestamp, so the same inputs produce the same bytes. Otherwise
    // every build writes a different archive and nothing downstream can tell a
    // real change from the clock moving.
    const time = 0;
    const date = 0x21; // 1 January 1980, the epoch the format allows.

    for (const file of files) {
        const name = Buffer.from(file.name, "utf8");
        const data = Buffer.isBuffer(file.data)
            ? file.data
            : Buffer.from(file.data, "utf8");
        const deflated = deflateRawSync(data, { level: 9 });
        const sum = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // local file header
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(8, 8); // deflate
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(sum, 14);
        local.writeUInt32LE(deflated.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28); // extra field length

        chunks.push(local, name, deflated);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0); // central directory header
        entry.writeUInt16LE(20, 4); // version made by
        entry.writeUInt16LE(20, 6); // version needed
        entry.writeUInt16LE(0, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt16LE(time, 12);
        entry.writeUInt16LE(date, 14);
        entry.writeUInt32LE(sum, 16);
        entry.writeUInt32LE(deflated.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt16LE(0, 30); // extra
        entry.writeUInt16LE(0, 32); // comment
        entry.writeUInt16LE(0, 34); // disk
        entry.writeUInt16LE(0, 36); // internal attrs
        // >>> 0 because << returns a signed int32 and this value overflows it.
        entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs, regular file
        entry.writeUInt32LE(offset, 42);

        central.push(entry, name);
        offset += local.length + name.length + deflated.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); // end of central directory
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...chunks, centralBuf, end]);
}
