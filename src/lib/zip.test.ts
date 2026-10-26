import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eindeutigeNamen, zipErstellen } from './zip';

async function alles(r: NodeJS.ReadableStream): Promise<Buffer> {
  const teile: Buffer[] = [];
  for await (const t of r) teile.push(Buffer.from(t as Buffer));
  return Buffer.concat(teile);
}

describe('ZIP', () => {
  it('lässt sich mit unzip prüfen und liefert dieselben Bytes', async () => {
    const a = Buffer.from('solid krone\nendsolid\n');
    const b = Buffer.alloc(70_000, 7);
    const zip = await alles(
      zipErstellen([
        { name: 'Krone 16.stl', groesse: a.length, oeffnen: async function* () { yield a; } },
        { name: 'Modell Ü.stl', groesse: b.length, oeffnen: async function* () { yield b.subarray(0, 1000); yield b.subarray(1000); } },
      ]),
    );
    const ordner = mkdtempSync(path.join(tmpdir(), 'ddl-zip-'));
    const datei = path.join(ordner, 'test.zip');
    writeFileSync(datei, zip);
    expect(execFileSync('unzip', ['-t', datei]).toString()).toContain('No errors detected');
    expect(execFileSync('unzip', ['-p', datei, 'Krone 16.stl']).toString()).toBe(a.toString());
    expect(execFileSync('unzip', ['-p', datei, 'Modell*']).equals(b)).toBe(true);
  });

  it('doppelte Namen bekommen eine Nummer', () => {
    expect(eindeutigeNamen(['Krone.stl', 'krone.stl', 'Krone.stl', 'Modell'])).toEqual(['Krone.stl', 'krone (2).stl', 'Krone (3).stl', 'Modell']);
  });
});
