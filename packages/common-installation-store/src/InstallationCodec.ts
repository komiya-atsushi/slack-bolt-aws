import {Installation} from '@slack/oauth';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';

interface Encryption {
  password: string;
  salt: string;
}

interface EncryptionWithAlgorithm extends Encryption {
  algorithm: string;
  ivLength: number;
  keyLength: number;
}

export interface BinaryInstallationCodecOptions {
  encryption?: Encryption | EncryptionWithAlgorithm;
  compression?: boolean;
}

export interface InstallationCodec {
  encode(installation: Installation): Buffer;
  decode(data: Buffer): Installation;
}

/**
 * Encodes Installation object into JSON string.
 */
export class JsonInstallationCodec implements InstallationCodec {
  static readonly INSTANCE = new JsonInstallationCodec();

  private constructor() {}

  encode(installation: Installation): Buffer {
    return Buffer.from(JSON.stringify(installation));
  }

  decode(data: Buffer): Installation {
    return JSON.parse(data.toString());
  }
}

/**
 * Provides functionalities to compress and/or encrypt Installation object.
 */
export class BinaryInstallationCodec implements InstallationCodec {
  private static readonly DEFAULT_ENCRYPTION_ALGORITHM = {
    algorithm: 'aes-256-ctr',
    ivLength: 16,
    keyLength: 32,
  };

  private key: Buffer | undefined;

  constructor(private readonly options: BinaryInstallationCodecOptions) {}

  static createDefault(
    password: string,
    salt: string
  ): BinaryInstallationCodec {
    return new BinaryInstallationCodec({
      encryption: {
        password,
        salt,
      },
      compression: true,
    });
  }

  private compressIfNeeded(data: Buffer): Buffer {
    const code = this.options.compression
      ? 'b' // Brotli
      : 'r'; // Raw
    if (code === 'b') {
      data = zlib.brotliCompressSync(data);
    }

    return Buffer.concat([Buffer.from(code), data]);
  }

  private encryptIfNeeded(data: Buffer): Buffer {
    if (!this.options.encryption) {
      return Buffer.concat([this.singleByteBuffer(0), data]);
    }

    const {algorithm, ivLength, keyLength} =
      'algorithm' in this.options.encryption
        ? this.options.encryption
        : BinaryInstallationCodec.DEFAULT_ENCRYPTION_ALGORITHM;

    const iv = crypto.randomBytes(ivLength);

    const key = this.prepareKey(this.options.encryption, keyLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    data = Buffer.concat([cipher.update(data), cipher.final()]);

    return Buffer.concat([
      this.singleByteBuffer(algorithm.length),
      Buffer.from(algorithm),
      this.singleByteBuffer(keyLength),
      this.singleByteBuffer(ivLength),
      iv,
      data,
    ]);
  }

  private prepareKey(
    encryption: NonNullable<BinaryInstallationCodecOptions['encryption']>,
    keyLength: number
  ): Buffer {
    if (this.key) {
      return this.key;
    }

    this.key = crypto.scryptSync(
      encryption.password,
      encryption.salt,
      keyLength
    );

    return this.key;
  }

  private singleByteBuffer(v: number): Buffer {
    if (v < 0 && v >= 256) {
      throw new Error(`v must be >= 0 and < 256 but ${v}`);
    }
    const result = Buffer.alloc(1);
    result.writeUint8(v);
    return result;
  }

  encode(installation: Installation): Buffer {
    let data = Buffer.from(JSON.stringify(installation));
    data = this.compressIfNeeded(data);
    data = this.encryptIfNeeded(data);
    return Buffer.concat([this.singleByteBuffer(1), data]);
  }

  private decompressIfNeeded(data: Buffer): Buffer {
    const code = data.readUint8(0);
    switch (code) {
      case 0x62: // b
        return zlib.brotliDecompressSync(data.subarray(1));
      case 0x72: // r
        return data.subarray(1);
      default:
        throw new Error(
          `Detected compression algorithm that is not supported: ${code}`
        );
    }
  }

  private decryptIfNeeded(data: Buffer): Buffer {
    const algorithmNameLength = data.readUint8(0);
    if (algorithmNameLength === 0) {
      return data.subarray(1);
    }

    let pos = 1;

    const algorithm = data.subarray(pos, pos + algorithmNameLength).toString();
    pos += algorithmNameLength;

    const keyLength = data.readUint8(pos);
    pos++;

    const ivLength = data.readUint8(pos);
    pos++;

    const iv = data.subarray(pos, pos + ivLength);
    pos += ivLength;

    const encryptedData = data.subarray(pos);

    const key = this.prepareKey(this.options.encryption!, keyLength);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  decode(raw: Buffer): Installation {
    const firstByte = raw.readUint8();
    switch (firstByte) {
      case 0x7b: // Raw JSON
        return JSON.parse(raw.toString());
      case 1: // Version 1 format
        return this.decodeV1(raw.subarray(1));
      default:
        throw new Error(
          `Detected format version that is not supported: ${firstByte}`
        );
    }
  }

  private decodeV1(raw: Buffer): Installation {
    let data = this.decryptIfNeeded(raw);
    data = this.decompressIfNeeded(data);
    return JSON.parse(data.toString());
  }
}
