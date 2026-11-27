// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT_DIR, relativePath), 'utf8');
}

describe('Slice 1: Dockerfile & .dockerignore hardening', () => {
  it('defines a multi-arch distroless nonroot Dockerfile with /nodejs/bin/node /healthz healthcheck', () => {
    const dockerfile = readRepoFile('Dockerfile');

    expect(dockerfile).toMatch(/FROM\s+--platform=\$BUILDPLATFORM\s+node:22-alpine\s+AS\s+builder/i);
    expect(dockerfile).toMatch(/FROM\s+gcr\.io\/distroless\/nodejs22-debian12:nonroot/i);
    expect(dockerfile).toMatch(/USER\s+65532(:65532)?/);
    expect(dockerfile).toMatch(/npm\s+ci/);
    expect(dockerfile).toMatch(/npm\s+run\s+build/);
    expect(dockerfile).toMatch(/npm\s+prune\s+--omit=dev/);
    expect(dockerfile).toMatch(/COPY\s+[^\n]*--from=builder[^\n]*\/app\/dist\s+/);
    expect(dockerfile).toMatch(/COPY\s+[^\n]*--from=builder[^\n]*\/app\/node_modules\s+/);
    expect(dockerfile).toMatch(/COPY\s+[^\n]*--from=builder[^\n]*\/app\/package\.json\s+/);
    expect(dockerfile).toMatch(/HEALTHCHECK\s+[\s\S]*CMD\s+\["\/nodejs\/bin\/node"/);
    expect(dockerfile).toContain('/healthz');
    expect(dockerfile).toContain('127.0.0.1');
    expect(dockerfile).toMatch(/CMD\s+\["dist\/server\/index\.js"\]/);
  });

  it('excludes sensitive/dev paths in .dockerignore while keeping build configs', () => {
    expect(existsSync(resolve(ROOT_DIR, '.dockerignore'))).toBe(true);
    const lines = readRepoFile('.dockerignore')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const requiredExclusion of [
      '.git',
      'node_modules',
      '.scratch',
      '.tor-bin',
      '.worktrees',
      'dist',
      'e2e',
      '**/*.test.ts',
    ]) {
      expect(lines).toContain(requiredExclusion);
    }

    // tsconfig.json includes vitest.config.ts for `tsc --noEmit` during `npm run build`
    expect(lines).not.toContain('vitest.config.ts');
    expect(lines).not.toContain('tsconfig.json');
    expect(lines).not.toContain('tsconfig.server.json');
  });
});

describe('Slice 2: Docker Compose, Caddyfile & .env.example', () => {
  it('configures minimal hardened pulso service and full profile with caddy + coturn', () => {
    const compose = readRepoFile('deploy/docker-compose.yml');

    // Minimal default service hardened and bound to loopback
    expect(compose).toMatch(/^\s{2}pulso:/m);
    expect(compose).toContain('127.0.0.1:${PULSO_BIND_PORT:-3001}:3001');
    expect(compose).toContain('ghcr.io/gugaucb/pulso:latest');
    expect(compose).not.toContain('ghcr.io/pulso/pulso');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('tmpfs:');
    expect(compose).toContain('/tmp');
    expect(compose).toMatch(/cap_drop:\s*\n\s*-\s*ALL|cap_drop:\s*\[ALL\]/);
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('TRUST_PROXY');

    // Full profile with Caddy and coturn
    expect(compose).toMatch(/^\s{2}caddy:/m);
    expect(compose).toMatch(/^\s{2}coturn:/m);
    expect(compose).toMatch(/profiles:\s*\n\s*-\s*full|profiles:\s*\["?full"?\]/);
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('network_mode: host');
    expect(compose).toMatch(/DETECT_EXTERNAL_IP:\s*"?\$\{DETECT_EXTERNAL_IP:-yes\}"?/);
    expect(compose).toContain('--use-auth-secret');
    expect(compose).toContain('--static-auth-secret=${TURN_SECRET');
    expect(compose).toContain('--listening-port=3478');
    expect(compose).toContain('--min-port=49160');
    expect(compose).toContain('--max-port=49300');
    expect(compose).toContain('--no-cli');
    expect(compose).toContain('--log-file=/dev/null');
    expect(compose).toContain('--no-stdout-log');
    expect(compose).toContain('--no-loopback-peers');
    expect(compose).toContain('--no-multicast-peers');

    // Anti-SSRF denied-peer-ip ranges (private, loopback, CGNAT, IMDS, IPv6 ULA/link-local)
    for (const deniedRange of [
      '0.0.0.0-0.255.255.255',
      '10.0.0.0-10.255.255.255',
      '100.64.0.0-100.127.255.255',
      '127.0.0.0-127.255.255.255',
      '169.254.0.0-169.254.255.255',
      '172.16.0.0-172.31.255.255',
      '192.168.0.0-192.168.255.255',
      '::1',
      'fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    ]) {
      expect(compose).toContain(`--denied-peer-ip=${deniedRange}`);
    }
  });

  it('configures zero-log Caddyfile with TLS, wss:// proxy, and privacy headers', () => {
    const caddyfile = readRepoFile('deploy/Caddyfile');

    expect(caddyfile).toContain('{$PULSO_DOMAIN}');
    expect(caddyfile).toMatch(/log\s*\{[\s\S]*output\s+discard[\s\S]*\}/);
    expect(caddyfile).toContain('Referrer-Policy "no-referrer"');
    expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(caddyfile).toContain('X-Content-Type-Options "nosniff"');
    expect(caddyfile).toContain('-Server');
    expect(caddyfile).toContain('reverse_proxy pulso:3001');
  });

  it('documents all canonical environment variables in deploy/.env.example', () => {
    const envExample = readRepoFile('deploy/.env.example');

    for (const envVar of [
      'PULSO_DOMAIN',
      'TRUST_PROXY',
      'PORT',
      'HOST',
      'STUN_URLS',
      'TURN_URLS',
      'TURN_SECRET',
      'TURN_TTL_SECONDS',
      'TURN_USERNAME',
      'TURN_CREDENTIAL',
      'TURN_REALM',
      'DETECT_EXTERNAL_IP',
      'PULSO_INACTIVITY_MS',
      'PULSO_GRACE_WINDOW_MS',
      'PULSO_MAX_ROOMS',
    ]) {
      expect(envExample).toMatch(new RegExp(`^#?\\s*${envVar}=`, 'm'));
    }
  });
});

describe('Slice 3: Official v1 1-click templates (Coolify, Portainer, Render, Fly.io)', () => {
  it('provides a hardened full-stack Coolify compose template with TRUST_PROXY=true and coturn anti-SSRF', () => {
    const coolify = readRepoFile('deploy/coolify/docker-compose.yml');

    expect(coolify).toMatch(/^\s{2}pulso:/m);
    expect(coolify).toMatch(/^\s{2}coturn:/m);
    expect(coolify).toContain('TRUST_PROXY: "true"');
    expect(coolify).toContain('ghcr.io/gugaucb/pulso:latest');
    expect(coolify).not.toContain('ghcr.io/pulso/pulso');
    expect(coolify).toContain('read_only: true');
    expect(coolify).toContain('no-new-privileges:true');
    expect(coolify).toContain('network_mode: host');
    expect(coolify).toContain('--use-auth-secret');
    expect(coolify).toContain('TURN_SECRET');
    expect(coolify).toContain('--denied-peer-ip=169.254.0.0-169.254.255.255');
    expect(coolify).toContain('--no-cli');
    expect(coolify).toContain('--log-file=/dev/null');
  });

  it('provides Portainer compose stack and valid templates.json referencing it', () => {
    const portainerCompose = readRepoFile('deploy/portainer/docker-compose.yml');
    expect(portainerCompose).toMatch(/^\s{2}pulso:/m);
    expect(portainerCompose).toMatch(/^\s{2}caddy:/m);
    expect(portainerCompose).toMatch(/^\s{2}coturn:/m);
    expect(portainerCompose).toContain('../Caddyfile:/etc/caddy/Caddyfile:ro');
    expect(portainerCompose).toContain('ghcr.io/gugaucb/pulso:latest');
    expect(portainerCompose).not.toContain('ghcr.io/pulso/pulso');
    expect(portainerCompose).toContain('read_only: true');
    expect(portainerCompose).toContain('network_mode: host');
    expect(portainerCompose).toContain('--use-auth-secret');
    expect(portainerCompose).toContain('--denied-peer-ip=10.0.0.0-10.255.255.255');

    const rawTemplates = readRepoFile('deploy/portainer/templates.json');
    const parsed = JSON.parse(rawTemplates) as {
      version: string;
      templates: Array<{
        type: number;
        title: string;
        repository: { stackfile: string };
        env: Array<{ name: string }>;
      }>;
    };

    expect(parsed.version).toBe('3');
    expect(parsed.templates.length).toBeGreaterThanOrEqual(1);
    const tpl = parsed.templates[0]!;
    expect(tpl.type).toBe(3);
    expect(tpl.title).toContain('PULSO');
    expect(tpl.repository.stackfile).toBe('deploy/portainer/docker-compose.yml');
    expect(rawTemplates).toContain('https://github.com/gugaucb/pulso');
    expect(rawTemplates).not.toContain('https://github.com/pulso/pulso');
    const envNames = tpl.env.map((e) => e.name);
    expect(envNames).toContain('PULSO_DOMAIN');
    expect(envNames).toContain('TURN_SECRET');
    expect(envNames).toContain('TURN_URLS');
    expect(envNames).toContain('TRUST_PROXY');
  });

  it('provides render.yaml Blueprint with /healthz check and external TURN documentation', () => {
    const renderYaml = readRepoFile('render.yaml');

    expect(renderYaml).toContain('runtime: docker');
    expect(renderYaml).toContain('dockerfilePath: ./Dockerfile');
    expect(renderYaml).toContain('healthCheckPath: /healthz');
    expect(renderYaml).toContain('TRUST_PROXY');
    expect(renderYaml).toContain('TURN_URLS');
    expect(renderYaml).toContain('TURN_SECRET');
    expect(renderYaml).toContain('TURN_USERNAME');
    expect(renderYaml).toContain('TURN_CREDENTIAL');
    expect(renderYaml).toMatch(/UDP|coturn|TURN externo/i);
  });

  it('provides fly.toml with auto_stop_machines = false, /healthz check, and external TURN docs', () => {
    const flyToml = readRepoFile('fly.toml');

    expect(flyToml).toContain('dockerfile = "Dockerfile"');
    expect(flyToml).toContain('[http_service]');
    expect(flyToml).toContain('internal_port = 3001');
    expect(flyToml).toContain('auto_stop_machines = false');
    expect(flyToml).toContain('[[http_service.checks]]');
    expect(flyToml).toContain('path = "/healthz"');
    expect(flyToml).toContain('TRUST_PROXY = "true"');
    expect(flyToml).toContain('TURN_URLS');
    expect(flyToml).toContain('TURN_SECRET');
  });
});
