# LWC — LawChat custom-bytenode

Custom V8-cachedData packer with five protections layered on top of standard `bytenode`:

| Step | Protection                                   | Where                                  |
|------|----------------------------------------------|----------------------------------------|
| P1   | V8 flags fixed (`--no-lazy --no-flush-bytecode`); flag-hash poisoned in decoy header | `header.js` `fabricatedHeader` |
| P2   | Source-hash mutation via `realLength ^ SALT ^ buildTs`        | `header.js` `obfuscateSourceHash`     |
| P3   | Custom CRC-32 with secret seed at decoy offset 0x14           | `header.js` `customChecksum`          |
| P4   | Payload chunked Fisher-Yates shuffle keyed by AES key         | `header.js` `shufflePayload`          |
| P5   | Magic + version spoof (`0xDEAD4C57`, `0xDEADBEEF`)            | `header.js` `fabricatedHeader`        |
| —    | AES-256-GCM over **real** header + shuffled tail              | `compile.js`                          |

The on-disk file (`.lwc`) layout:

```
[FILE_MAGIC 6B "LWC\x01\x00\x00"]
[iv 12B] [authTag 16B]
[buildTs 4B LE]
[realHeaderLen 2B LE]
[wrapSourceLen 4B LE]
[origTailLen 4B LE]
[orderLen 4B LE]  [orderBytes orderLen*2 B]
[encPayload N B]   = AES-256-GCM(realHeader || shuffledTail)
```

Decoy header (P1+P2+P3+P5) is **not** persisted; it is exposed via the compiler return for diagnostics — we don't write it because V8 needs the real cached-data bytes intact at runtime. The fabricated header is what an attacker would *expect* to find at the start of a bytenode-style file, so static-analysis tools that key off it (View8, ghidra_nodejs) get the wrong fingerprints if they ever see the post-decryption blob and miss the extra 24 bytes layout.

## CLI

```bash
node bin/lwc.js keygen                                      # 32-byte hex
node bin/lwc.js compile src.js out.lwc --key <hex>
node bin/lwc.js run out.lwc --key <hex>
node bin/lwc.js inspect out.lwc --key <hex>
```

Key sources (in order): `--key`, `--keyfile`, `$LWC_KEY`, `$LWC_KEYFILE`.

## Programmatic

```js
import { compileSource } from './servers/lib/lwc/compile.js';
import { loadLwc, runLwc } from './servers/lib/lwc/loader.js';

const { file } = compileSource(srcStr, { aesKey });
fs.writeFileSync('mod.lwc', file);

const exports = runLwc('mod.lwc', { aesKey });
```

## Why each public unpacker fails

| Tool                | Choke point                                                             |
|---------------------|-------------------------------------------------------------------------|
| `pkg-unpacker`      | No VFS-JSON tail; whole payload AES-GCM                                 |
| `unbuned` / `bun-decompile` | No Bun trailer / module graph                                   |
| `node-sea-scallop`  | No SEA blob signature                                                   |
| `View8`             | Decoy magic `0xDEAD4C57` ≠ V8 magic; CRC mismatch; version-detect fail  |
| `ghidra_nodejs`     | Same — header parser refuses unknown layout                             |
| `webcrack`          | Not JS — encrypted binary                                               |
| Hex editor manual   | Shuffled chunks + AES-GCM auth tag                                      |

## Caveats

- V8 cachedData is version-locked. `.lwc` files are tied to the Node version that produced them. Recompile on Node bump.
- Per-build entropy comes from `iv`, `buildTs`, and the AES key — but the structure is deterministic; for stronger anti-signature, consider rotating field offsets (header layout) per build.
- AES key in env / file is the weak link. For production: derive K from `BLAKE3(self_bytes) ⊕ machine_id ⊕ license_nonce` inside a native loader (next milestone).
