// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.resolve(ROOT_DIR, 'docs');
const GUIDES_DIR = path.resolve(DOCS_DIR, 'guides');
const LOCALES = ['pt-br', 'en', 'es', 'zh-CN'] as const;
type Locale = (typeof LOCALES)[number];

const EXPECTED_GUIDE_FILES = [
  'README.md',
  'host-quickstart.md',
  'verification-offline-bridges.md',
  'operator-server.md',
] as const;

function collectMarkdownFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectMarkdownFiles(full, acc);
    } else if (st.isFile() && entry.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc.sort();
}

function stripNonProseForGlossary(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ');
}

function stripFencedCodeAndInlineCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
}

function extractRelativeMarkdownLinks(markdown: string): string[] {
  const cleaned = stripFencedCodeAndInlineCode(markdown);
  const links: string[] = [];
  const regex = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of cleaned.matchAll(regex)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (
      !rawTarget ||
      rawTarget.startsWith('#') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawTarget)
    ) {
      continue;
    }
    const withoutTitle = rawTarget.split(/\s+/)[0];
    const cleanPath = withoutTitle.split('#')[0].split('?')[0];
    if (cleanPath) {
      links.push(cleanPath);
    }
  }
  return links;
}

function readGuide(locale: Locale, fileName: (typeof EXPECTED_GUIDE_FILES)[number]): string {
  return readFileSync(path.join(GUIDES_DIR, locale, fileName), 'utf8');
}

describe('PULSO documentation structure and links', () => {
  it('provides matching guide files across all 4 locales (pt-br, en, es, zh-CN)', () => {
    expect(existsSync(path.join(GUIDES_DIR, 'README.md'))).toBe(true);

    for (const locale of LOCALES) {
      const localeDir = path.join(GUIDES_DIR, locale);
      expect(existsSync(localeDir), `Missing locale directory: ${locale}`).toBe(true);
      const files = readdirSync(localeDir)
        .filter((name) => name.endsWith('.md'))
        .sort();
      expect(files, `Guide file mismatch for locale ${locale}`).toEqual(
        [...EXPECTED_GUIDE_FILES].sort(),
      );
    }
  });

  it('resolves every relative markdown link under docs/ to an existing file in the repository', () => {
    const markdownFiles = collectMarkdownFiles(DOCS_DIR);
    expect(markdownFiles.length).toBeGreaterThan(0);

    const brokenLinks: string[] = [];
    for (const filePath of markdownFiles) {
      const content = readFileSync(filePath, 'utf8');
      const links = extractRelativeMarkdownLinks(content);
      for (const link of links) {
        const resolved = path.resolve(path.dirname(filePath), link);
        if (!existsSync(resolved)) {
          const relSource = path.relative(ROOT_DIR, filePath);
          brokenLinks.push(`${relSource} -> ${link}`);
        }
      }
    }

    expect(brokenLinks, `Broken markdown links found:\n${brokenLinks.join('\n')}`).toEqual([]);
  });
});

describe('PULSO pt-br GLOSSARY.md compliance', () => {
  const CANONICAL_PT_BR_TERMS = [
    'Instância',
    'Operador',
    'Sala',
    'Código da Sala',
    'Participante',
    'Anfitrião',
    'Convidado',
    'Modo Normal',
    'Modo Tor',
    'Mensagem Efêmera',
    'Chamada de Vídeo',
    'Contador de Inatividade',
  ] as const;

  const AVOIDED_PROSE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
    { label: 'canal/canais', regex: /\bcan(?:al|ais)\b/gi },
    { label: 'grupo(s)', regex: /\bgrupos?\b/gi },
    { label: 'chat(s)', regex: /\bchats?\b/gi },
    { label: 'thread(s)', regex: /\bthreads?\b/gi },
    { label: 'workspace(s)', regex: /\bworkspaces?\b/gi },
    { label: 'token(s)', regex: /\btokens?\b/gi },
    { label: 'senha(s)', regex: /\bsenhas?\b/gi },
    { label: 'chave de acesso', regex: /\bchave de acesso\b/gi },
    { label: 'ID da sala', regex: /\bid da sala\b/gi },
    { label: 'usuário(s)/usuária(s)', regex: /\busuári[oa]s?\b/gi },
    { label: 'conta(s)', regex: /\bcontas?\b/gi },
    { label: 'membro(s)', regex: /\bmembros?\b/gi },
    { label: 'cliente(s)', regex: /\bclientes?\b/gi },
    { label: 'criador(es)', regex: /\bcriador(?:es)?\b/gi },
    { label: 'dono(s)', regex: /\bdonos?\b/gi },
    { label: 'admin(s)', regex: /\badmins?\b/gi },
    { label: 'host', regex: /\bhost\b/gi },
    { label: 'entrante(s)', regex: /\bentrantes?\b/gi },
    { label: 'receptor(es)', regex: /\breceptor(?:es)?\b/gi },
    { label: 'peer(s)', regex: /\bpeers?\b/gi },
    { label: 'modo padrão', regex: /\bmodo padrão\b/gi },
    { label: 'modo web', regex: /\bmodo web\b/gi },
    { label: 'modo público', regex: /\bmodo público\b/gi },
    { label: 'modo anônimo', regex: /\bmodo anônimo\b/gi },
    { label: 'modo onion', regex: /\bmodo onion\b/gi },
    { label: 'modo escuro', regex: /\bmodo escuro\b/gi },
    { label: 'histórico', regex: /\bhistórico\b/gi },
    { label: 'post(s)', regex: /\bposts?\b/gi },
    { label: 'log(s)', regex: /\blogs?\b/gi },
    {
      label: 'bare mensagem/mensagens (without Efêmera)',
      regex: /\bmensagens?\b(?!\s+efêmeras?\b)/gi,
    },
    { label: 'reunião/reuniões', regex: /\breuni(?:ão|ões)\b/gi },
    { label: 'videoconferência(s)', regex: /\bvideoconferências?\b/gi },
    { label: 'call', regex: /\bcall\b/gi },
    { label: 'live', regex: /\blive\b/gi },
    { label: 'TTL', regex: /\bttl\b/gi },
    { label: 'timeout', regex: /\btimeout\b/gi },
    { label: 'cronômetro', regex: /\bcronômetro\b/gi },
    { label: 'expiração', regex: /\bexpiração\b/gi },
    { label: 'deploy', regex: /\bdeploy\b/gi },
    { label: 'nó(s)', regex: /\bnós?\b/gi },
    { label: 'cluster(s)', regex: /\bclusters?\b/gi },
    { label: 'ambiente(s)', regex: /\bambientes?\b/gi },
    { label: 'provedor(es)', regex: /\bprovedor(?:es)?\b/gi },
    { label: 'dono do servidor', regex: /\bdono do servidor\b/gi },
  ];

  it('uses every canonical GLOSSARY.md term across docs/guides/pt-br/', () => {
    const ptBrAll = EXPECTED_GUIDE_FILES.map((file) => readGuide('pt-br', file)).join('\n');
    for (const term of CANONICAL_PT_BR_TERMS) {
      expect(ptBrAll, `Missing canonical GLOSSARY term '${term}' in pt-br guides`).toContain(term);
    }
  });

  it('does not use GLOSSARY.md avoided synonyms in pt-br guides or docs/tor-mode.md prose', () => {
    const ptBrFiles = [
      ...EXPECTED_GUIDE_FILES.map((file) => path.join(GUIDES_DIR, 'pt-br', file)),
      path.join(DOCS_DIR, 'tor-mode.md'),
    ];

    const violations: string[] = [];
    for (const filePath of ptBrFiles) {
      const prose = stripNonProseForGlossary(readFileSync(filePath, 'utf8'));
      const rel = path.relative(ROOT_DIR, filePath);
      for (const { label, regex } of AVOIDED_PROSE_PATTERNS) {
        regex.lastIndex = 0;
        const matches = [...prose.matchAll(regex)].map((m) => m[0]);
        if (matches.length > 0) {
          violations.push(`${rel}: found avoided '${label}' (${matches.slice(0, 3).join(', ')})`);
        }
      }
    }

    expect(violations, `Glossary violations found:\n${violations.join('\n')}`).toEqual([]);
  });
});

describe('Technical coverage across all 4 locales and tor-mode.md', () => {
  const QUICKSTART_LOCALE_MARKERS: Record<
    Locale,
    { sequoia: string; smartScreen: string; purgeLabel: string; localTitle: string }
  > = {
    'pt-br': {
      sequoia: 'Abrir Mesmo Assim',
      smartScreen: 'Executar assim mesmo',
      purgeLabel: 'Encerrar e purgar rastro',
      localTitle: 'PULSO Local / Túnel',
    },
    en: {
      sequoia: 'Open Anyway',
      smartScreen: 'Run anyway',
      purgeLabel: 'Stop and purge trace',
      localTitle: 'PULSO Local / Tunnel',
    },
    es: {
      sequoia: 'Abrir de todos modos',
      smartScreen: 'Ejecutar de todas formas',
      purgeLabel: 'Cerrar y purgar rastro',
      localTitle: 'PULSO Local / Túnel',
    },
    'zh-CN': {
      sequoia: '仍要打开',
      smartScreen: '仍要运行',
      purgeLabel: '关闭并清除痕迹',
      localTitle: 'PULSO 本地 / 隧道',
    },
  };

  it('covers 3-step v1 opening (Sequoia/SmartScreen/Linux), tray purge, and zero phone-home in host-quickstart.md for all locales', () => {
    for (const locale of LOCALES) {
      const doc = readGuide(locale, 'host-quickstart.md');
      const markers = QUICKSTART_LOCALE_MARKERS[locale];

      expect(doc, `${locale}: missing PULSO Tor`).toContain('PULSO Tor');
      expect(doc, `${locale}: missing ${markers.localTitle}`).toContain(markers.localTitle);
      expect(doc, `${locale}: missing macOS Sequoia Gatekeeper step`).toContain(markers.sequoia);
      expect(doc, `${locale}: missing Windows SmartScreen step`).toContain(markers.smartScreen);
      expect(doc, `${locale}: missing .AppImage`).toContain('.AppImage');
      expect(doc, `${locale}: missing .deb`).toContain('.deb');
      expect(doc, `${locale}: missing tray purge action`).toContain(markers.purgeLabel);
      expect(doc, `${locale}: missing Tor Browser manual check`).toContain('Tor Browser');
    }
  });

  it('covers PGP/SHA-256 verification, offline USB, private bridges, and .onion mirrors in verification-offline-bridges.md for all locales', () => {
    for (const locale of LOCALES) {
      const doc = readGuide(locale, 'verification-offline-bridges.md');

      expect(doc, `${locale}: missing SHA256SUMS`).toContain('SHA256SUMS');
      expect(doc, `${locale}: missing SHA256SUMS.asc`).toContain('SHA256SUMS.asc');
      expect(doc, `${locale}: missing gpg --verify`).toContain('gpg --verify');
      expect(doc, `${locale}: missing sha256sum/shasum`).toMatch(/sha256sum|shasum -a 256/);
      expect(doc, `${locale}: missing bridges.torproject.org`).toContain('bridges.torproject.org');
      expect(doc, `${locale}: missing @GetBridgesBot`).toContain('@GetBridgesBot');
      expect(doc, `${locale}: missing bridges@torproject.org`).toContain('bridges@torproject.org');
      expect(doc, `${locale}: missing Snowflake`).toContain('Snowflake');
      expect(doc, `${locale}: missing lyrebird`).toContain('lyrebird');
      expect(doc, `${locale}: missing obfs4`).toContain('obfs4');
      expect(doc, `${locale}: missing webtunnel`).toContain('webtunnel');
      expect(doc, `${locale}: missing .onion mirror instructions`).toContain('HiddenServiceDir');
      expect(doc, `${locale}: missing mirror-release.mjs reference`).toContain('mirror-release.mjs');
    }
  });

  it('covers PULSO Servidor profiles, firewall ports, env vars, 1-click templates, and external TURN in operator-server.md for all locales', () => {
    for (const locale of LOCALES) {
      const doc = readGuide(locale, 'operator-server.md');

      expect(doc, `${locale}: missing --profile full`).toContain('--profile full');
      expect(doc, `${locale}: missing ghcr.io/pulso-app/pulso`).toContain('ghcr.io/pulso-app/pulso');
      expect(doc, `${locale}: unexpected placeholder <org>`).not.toContain('ghcr.io/<org>/pulso');
      expect(doc, `${locale}: missing deploy/docker-compose.yml`).toContain('deploy/docker-compose.yml');
      expect(doc, `${locale}: missing Caddy`).toContain('Caddy');
      expect(doc, `${locale}: missing coturn`).toContain('coturn');
      expect(doc, `${locale}: missing 80/tcp`).toContain('80/tcp');
      expect(doc, `${locale}: missing 443/tcp`).toContain('443/tcp');
      expect(doc, `${locale}: missing 443/udp`).toContain('443/udp');
      expect(doc, `${locale}: missing 3478/tcp`).toContain('3478/tcp');
      expect(doc, `${locale}: missing 3478/udp`).toContain('3478/udp');
      expect(doc, `${locale}: missing 49160`).toContain('49160');
      expect(doc, `${locale}: missing 49300`).toContain('49300');
      expect(doc, `${locale}: missing DETECT_EXTERNAL_IP`).toContain('DETECT_EXTERNAL_IP');
      expect(doc, `${locale}: missing TRUST_PROXY`).toContain('TRUST_PROXY');
      expect(doc, `${locale}: missing Coolify`).toContain('Coolify');
      expect(doc, `${locale}: missing Portainer.io`).toContain('Portainer');
      expect(doc, `${locale}: missing Render`).toContain('Render');
      expect(doc, `${locale}: missing Fly.io`).toContain('Fly.io');
      expect(doc, `${locale}: missing auto_stop_machines`).toContain('auto_stop_machines');
      expect(doc, `${locale}: missing TURN_URLS`).toContain('TURN_URLS');
      expect(doc, `${locale}: missing TURN_SECRET`).toContain('TURN_SECRET');
    }
  });

  it('updates docs/tor-mode.md to reflect os.tmpdir(), lyrebird, and links to the new guides', () => {
    const torMode = readFileSync(path.join(DOCS_DIR, 'tor-mode.md'), 'utf8');

    expect(torMode).toContain('os.tmpdir()');
    expect(torMode).toContain('lyrebird');
    expect(torMode).toContain('./guides/');
    expect(torMode).not.toContain('./tor_data');
  });
});
