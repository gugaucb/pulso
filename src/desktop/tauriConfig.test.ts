// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TAURI_DIR = path.resolve(process.cwd(), 'src-tauri');

function readJson<T>(relativePath: string): T {
  const fullPath = path.join(TAURI_DIR, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

describe('Tauri v2 configuration invariants', () => {
  it('configures Cargo.toml with Tauri v2 tray-icon, shell, opener, and flavor features', () => {
    const cargoToml = readFileSync(path.join(TAURI_DIR, 'Cargo.toml'), 'utf8');

    expect(cargoToml).toContain('tauri = { version = "2", features = ["tray-icon"] }');
    expect(cargoToml).toContain('tauri-plugin-shell = "2"');
    expect(cargoToml).toContain('tauri-plugin-opener = "2"');
    expect(cargoToml).toContain('tauri-build = { version = "2"');
    expect(cargoToml).toContain('flavor-tor = []');
    expect(cargoToml).toContain('flavor-local = []');
  });

  it('configures shared base tauri.conf.json with desktop-ui build, OS bundle targets, icons, and macOS ad-hoc signing', () => {
    const baseConf = readJson<{
      productName: string;
      build: { beforeBuildCommand: string; frontendDist: string; devUrl: string };
      app: { withGlobalTauri: boolean; windows: Array<{ url: string }> };
      bundle: {
        active: boolean;
        targets: string[];
        icon: string[];
        macOS: { signingIdentity: string };
      };
    }>('tauri.conf.json');

    expect(baseConf.build.beforeBuildCommand).toBe('npm run build:desktop-ui');
    expect(baseConf.build.frontendDist).toBe('../dist-desktop');
    expect(baseConf.app.withGlobalTauri).toBe(true);
    expect(baseConf.app.windows[0]?.url).toBe('desktop.html');
    expect(baseConf.bundle.active).toBe(true);
    expect(baseConf.bundle.targets).toEqual(
      expect.arrayContaining(['dmg', 'app', 'nsis', 'appimage', 'deb']),
    );
    expect(baseConf.bundle.macOS.signingIdentity).toBe('-');

    for (const iconRelPath of baseConf.bundle.icon) {
      const iconPath = path.join(TAURI_DIR, iconRelPath);
      expect(existsSync(iconPath)).toBe(true);
    }
  });

  it('isolates PULSO Tor flavor to sidecar + Tor/lyrebird + dist without cloudflared', () => {
    const torConf = readJson<{
      productName: string;
      identifier: string;
      bundle: {
        externalBin: string[];
        resources: Record<string, string>;
        macOS: { signingIdentity: string };
      };
    }>('tauri.tor.conf.json');

    expect(torConf.productName).toBe('PULSO Tor');
    expect(torConf.identifier).toBe('org.pulso.tor');
    expect(torConf.bundle.externalBin).toEqual(['binaries/pulso-sidecar']);
    expect(JSON.stringify(torConf)).not.toContain('cloudflared');
    expect(torConf.bundle.resources['../dist/']).toBe('dist/');
    expect(torConf.bundle.resources['resources/tor/']).toBe('tor/');
    expect(torConf.bundle.macOS.signingIdentity).toBe('-');
  });

  it('isolates PULSO Local flavor to sidecar + cloudflared + dist without Tor or lyrebird', () => {
    const localConf = readJson<{
      productName: string;
      identifier: string;
      bundle: {
        externalBin: string[];
        resources: Record<string, string>;
        macOS: { signingIdentity: string };
      };
    }>('tauri.local.conf.json');

    expect(localConf.productName).toBe('PULSO Local');
    expect(localConf.identifier).toBe('org.pulso.local');
    expect(localConf.bundle.externalBin).toEqual([
      'binaries/pulso-sidecar',
      'binaries/cloudflared',
    ]);
    expect(JSON.stringify(localConf)).not.toContain('lyrebird');
    expect(JSON.stringify(localConf)).not.toContain('resources/tor');
    expect(localConf.bundle.resources['../dist/']).toBe('dist/');
    expect(localConf.bundle.macOS.signingIdentity).toBe('-');
  });

  it('defines Tauri v2 default capabilities for main window, opener, and sidecar shell', () => {
    const cap = readJson<{
      identifier: string;
      windows: string[];
      permissions: Array<string | { identifier: string; allow?: Array<{ name: string; sidecar?: boolean }> }>;
    }>('capabilities/default.json');

    expect(cap.identifier).toBe('default');
    expect(cap.windows).toContain('main');
    expect(cap.permissions).toContain('core:default');
    expect(cap.permissions).toContain('opener:default');
    expect(cap.permissions).toContain('shell:allow-kill');

    const spawnPerm = cap.permissions.find(
      (p) => typeof p === 'object' && p.identifier === 'shell:allow-spawn',
    );
    expect(spawnPerm).toBeDefined();
    expect(
      typeof spawnPerm === 'object' &&
        spawnPerm.allow?.some((entry) => entry.name === 'binaries/pulso-sidecar' && entry.sidecar),
    ).toBe(true);
  });

  it('ships valid binary icon headers (PNG, ICO, ICNS) so Tauri bundling never fails', () => {
    const png32 = readFileSync(path.join(TAURI_DIR, 'icons/32x32.png'));
    const png128 = readFileSync(path.join(TAURI_DIR, 'icons/128x128.png'));
    const png256 = readFileSync(path.join(TAURI_DIR, 'icons/128x128@2x.png'));
    const ico = readFileSync(path.join(TAURI_DIR, 'icons/icon.ico'));
    const icns = readFileSync(path.join(TAURI_DIR, 'icons/icon.icns'));

    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png32.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(png128.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(png256.subarray(0, 8)).toEqual(PNG_MAGIC);

    // ICO header: reserved=0, type=1, count>=1
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1);

    // ICNS magic: 'icns'
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});
