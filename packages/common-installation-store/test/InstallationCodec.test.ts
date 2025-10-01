import {
  BinaryInstallationCodec,
  JsonInstallationCodec,
} from '../src/InstallationCodec';
import {installation} from './test-data';

describe('JsonInstallationCodec', () => {
  test('can encode the Installation object and decode its results', () => {
    const codec = JsonInstallationCodec.INSTANCE;

    const encoded = codec.encode(installation);
    const decoded = codec.decode(encoded);

    expect(decoded).toEqual(installation);
  });
});

describe('BinaryInstallationCodec', () => {
  describe('Default configuration', () => {
    const codec = BinaryInstallationCodec.createDefault('password', 'salt');
    const anotherPasswordCodec = BinaryInstallationCodec.createDefault(
      'PASSWORD',
      'salt',
    );

    describe('BinaryInstallationCodec.encode()', () => {
      test('can encode the Installation object without errors', () => {
        const encoded = codec.encode(installation);
        expect(encoded.length).toBeGreaterThan(1);
      });

      test('generates different encoding results each time it is called', () => {
        const encoded = codec.encode(installation);
        const encoded2 = codec.encode(installation);
        expect(encoded).not.toEqual(encoded2);
      });
    });

    describe('BinaryInstallationCodec.decode()', () => {
      const encoded = codec.encode(installation);

      test('can decode the data that was encoded with a same password', () => {
        const decoded = codec.decode(encoded);
        expect(decoded).toEqual(installation);
      });

      test('fails to decode the data that was encoded with a different password', () => {
        expect(() => {
          anotherPasswordCodec.decode(encoded);
        }).toThrow();
      });

      test('can handle raw JSON installation', () => {
        const decoded = codec.decode(Buffer.from(JSON.stringify(installation)));
        expect(decoded).toEqual(installation);
      });
    });
  });

  describe('without encryption', () => {
    const codec = new BinaryInstallationCodec({
      compression: true,
    });

    describe('BinaryInstallationCodec.encode()', () => {
      test('can encode the Installation object without errors', () => {
        const encoded = codec.encode(installation);
        expect(encoded.length).toBeGreaterThan(1);
      });

      test('generates same encoding results each time it is called', () => {
        const encoded = codec.encode(installation);
        const encoded2 = codec.encode(installation);
        expect(encoded).toEqual(encoded2);
      });
    });

    describe('BinaryInstallationCodec.decode()', () => {
      const encoded = codec.encode(installation);

      test('can decode the encoded data', () => {
        const decoded = codec.decode(encoded);
        expect(decoded).toEqual(installation);
      });
    });
  });

  describe('without compression', () => {
    const codec = new BinaryInstallationCodec({
      encryption: {
        password: 'password',
        salt: 'salt',
        algorithm: 'aes-192-ctr',
        keyLength: 24,
        ivLength: 16,
      },
      compression: false,
    });

    describe('BinaryInstallationCodec.encode()', () => {
      test('can encode the Installation object without errors', () => {
        const encoded = codec.encode(installation);
        expect(encoded.length).toBeGreaterThan(1);
      });
    });

    describe('BinaryInstallationCodec.decode()', () => {
      const encoded = codec.encode(installation);

      test('can decode the encoded data', () => {
        const decoded = codec.decode(encoded);
        expect(decoded).toEqual(installation);
      });
    });
  });
});
