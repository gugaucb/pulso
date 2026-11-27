#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDirectExecution } from './lib/cli-utils.mjs';
import { formatReleaseTag, normalizeVersion } from './release-artifacts.mjs';

export const DEFAULT_CODEBERG_URL = 'https://codeberg.org';
export const DEFAULT_GITLAB_URL = 'https://gitlab.com';

const CHECKSUM_MIRROR_FILES = new Set([
  'SHA256SUMS',
  'SHA256SUMS.asc',
  'pulso-release-key.asc',
]);

/**
 * Filters release files to include ONLY PULSO Tor artifacts plus `SHA256SUMS`, `SHA256SUMS.asc`, and `pulso-release-key.asc`.
 */
export function selectTorMirrorFiles(fileNames) {
  return [...fileNames]
    .map((name) => path.basename(String(name)))
    .filter((name) => name.startsWith('pulso-tor-') || CHECKSUM_MIRROR_FILES.has(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function buildReleaseNotes(tagName) {
  return [
    `PULSO Tor ${tagName} — self-contained zero-trace desktop mirror.`,
    '',
    'Verify integrity with `SHA256SUMS`, `SHA256SUMS.asc`, and `pulso-release-key.asc` before running.',
  ].join('\n');
}

/**
 * Builds the Codeberg / Forgejo / Gitea Releases API plan for mirroring PULSO Tor.
 */
export function buildCodebergMirrorPlan({
  baseUrl = DEFAULT_CODEBERG_URL,
  repo,
  version,
  files = [],
}) {
  const cleanBase = String(baseUrl || DEFAULT_CODEBERG_URL).replace(/\/+$/, '');
  const cleanRepo = String(repo || '').replace(/^\/+|\/+$/g, '');
  if (!cleanRepo) {
    throw new Error('Codeberg mirror requires a repository slug (<owner>/<repo>)');
  }
  const normalizedVersion = normalizeVersion(version);
  const tagName = formatReleaseTag(normalizedVersion);
  const filteredFiles = selectTorMirrorFiles(files);

  return {
    provider: 'codeberg',
    baseUrl: cleanBase,
    repo: cleanRepo,
    tagName,
    releaseCreateUrl: `${cleanBase}/api/v1/repos/${cleanRepo}/releases`,
    releaseByTagUrl: `${cleanBase}/api/v1/repos/${cleanRepo}/releases/tags/${encodeURIComponent(tagName)}`,
    releasePayload: {
      tag_name: tagName,
      name: `PULSO Tor ${tagName}`,
      body: buildReleaseNotes(tagName),
      draft: false,
      prerelease: normalizedVersion.includes('-'),
    },
    files: filteredFiles,
  };
}

/**
 * Builds the GitLab Generic Package Registry + Releases API v4 plan for mirroring PULSO Tor.
 */
export function buildGitlabMirrorPlan({
  baseUrl = DEFAULT_GITLAB_URL,
  project,
  version,
  files = [],
}) {
  const cleanBase = String(baseUrl || DEFAULT_GITLAB_URL).replace(/\/+$/, '');
  const cleanProject = String(project || '').replace(/^\/+|\/+$/g, '');
  if (!cleanProject) {
    throw new Error('GitLab mirror requires a project path (<group>/<project>) or numeric ID');
  }
  const encodedProject = encodeURIComponent(cleanProject);
  const normalizedVersion = normalizeVersion(version);
  const tagName = formatReleaseTag(normalizedVersion);
  const filteredFiles = selectTorMirrorFiles(files);

  const packageUploads = filteredFiles.map((file) => {
    const uploadUrl = `${cleanBase}/api/v4/projects/${encodedProject}/packages/generic/pulso-tor/${encodeURIComponent(normalizedVersion)}/${encodeURIComponent(file)}`;
    return { file, uploadUrl };
  });

  return {
    provider: 'gitlab',
    baseUrl: cleanBase,
    project: cleanProject,
    tagName,
    releaseCreateUrl: `${cleanBase}/api/v4/projects/${encodedProject}/releases`,
    packageUploads,
    releasePayload: {
      name: `PULSO Tor ${tagName}`,
      tag_name: tagName,
      description: buildReleaseNotes(tagName),
      assets: {
        links: packageUploads.map((item) => ({
          name: item.file,
          url: item.uploadUrl,
          link_type: 'package',
        })),
      },
    },
    files: filteredFiles,
  };
}

async function mirrorToCodeberg({ dir, plan, token, fetchFn = globalThis.fetch }) {
  const authHeaders = {
    Authorization: `token ${token}`,
    Accept: 'application/json',
  };

  let releaseId;
  const existingRes = await fetchFn(plan.releaseByTagUrl, {
    method: 'GET',
    headers: authHeaders,
  });

  if (existingRes.ok) {
    const existing = await existingRes.json();
    releaseId = existing.id;
  } else if (existingRes.status === 404) {
    const createRes = await fetchFn(plan.releaseCreateUrl, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(plan.releasePayload),
    });
    if (!createRes.ok) {
      throw new Error(`Codeberg release creation failed: HTTP ${createRes.status}`);
    }
    const created = await createRes.json();
    releaseId = created.id;
  } else {
    throw new Error(`Codeberg release lookup failed: HTTP ${existingRes.status}`);
  }

  for (const file of plan.files) {
    const bytes = readFileSync(path.join(dir, file));
    const form = new FormData();
    form.append('attachment', new Blob([bytes]), file);
    const uploadUrl = `${plan.baseUrl}/api/v1/repos/${plan.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(file)}`;
    const uploadRes = await fetchFn(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `token ${token}` },
      body: form,
    });
    if (!uploadRes.ok) {
      throw new Error(`Codeberg asset upload failed for ${file}: HTTP ${uploadRes.status}`);
    }
  }

  return { provider: 'codeberg', releaseId, uploadedFiles: plan.files };
}

async function mirrorToGitlab({ dir, plan, token, fetchFn = globalThis.fetch }) {
  const authHeaders = {
    'PRIVATE-TOKEN': token,
    Accept: 'application/json',
  };

  for (const item of plan.packageUploads) {
    const bytes = readFileSync(path.join(dir, item.file));
    const uploadRes = await fetchFn(item.uploadUrl, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    if (!uploadRes.ok) {
      throw new Error(`GitLab package upload failed for ${item.file}: HTTP ${uploadRes.status}`);
    }
  }

  const releaseRes = await fetchFn(plan.releaseCreateUrl, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(plan.releasePayload),
  });
  if (!releaseRes.ok && releaseRes.status !== 409) {
    throw new Error(`GitLab release creation failed: HTTP ${releaseRes.status}`);
  }

  return { provider: 'gitlab', tagName: plan.tagName, uploadedFiles: plan.files };
}

export function resolveMirrorTargets({
  provider = 'all',
  env = process.env,
  codebergRepo = null,
  codebergUrl = null,
  gitlabProject = null,
  gitlabUrl = null,
  dryRun = false,
}) {
  const targets = [];
  const wantsCodeberg = provider === 'all' || provider === 'codeberg';
  const wantsGitlab = provider === 'all' || provider === 'gitlab';

  const cbToken = env.CODEBERG_TOKEN?.trim() || '';
  const cbRepo = (codebergRepo || env.CODEBERG_REPO || (dryRun ? 'gugaucb/pulso' : '')).trim();
  const cbBase = (codebergUrl || env.CODEBERG_URL || DEFAULT_CODEBERG_URL).trim();

  if (wantsCodeberg && cbRepo && (dryRun || cbToken)) {
    targets.push({ provider: 'codeberg', baseUrl: cbBase, repo: cbRepo, token: cbToken });
  }

  const glToken = env.GITLAB_TOKEN?.trim() || '';
  const glProject = (
    gitlabProject ||
    env.GITLAB_PROJECT ||
    (dryRun ? 'gugaucb/pulso' : '')
  ).trim();
  const glBase = (gitlabUrl || env.GITLAB_URL || DEFAULT_GITLAB_URL).trim();

  if (wantsGitlab && glProject && (dryRun || glToken)) {
    targets.push({ provider: 'gitlab', baseUrl: glBase, project: glProject, token: glToken });
  }

  return targets;
}

/**
 * Mirrors PULSO Tor artifacts + `SHA256SUMS` + `SHA256SUMS.asc` to configured Codeberg/GitLab Releases.
 */
export async function mirrorRelease({
  dir,
  version,
  provider = 'all',
  env = process.env,
  codebergRepo = null,
  codebergUrl = null,
  gitlabProject = null,
  gitlabUrl = null,
  dryRun = false,
  requireConfig = false,
  fetchFn = globalThis.fetch,
}) {
  const availableFiles = existsSync(dir)
    ? readdirSync(dir).filter((name) => {
        const fullPath = path.join(dir, name);
        return existsSync(fullPath) && statSync(fullPath).isFile();
      })
    : [];
  const files = selectTorMirrorFiles(availableFiles);

  const targets = resolveMirrorTargets({
    provider,
    env,
    codebergRepo,
    codebergUrl,
    gitlabProject,
    gitlabUrl,
    dryRun,
  });

  if (targets.length === 0) {
    if (requireConfig) {
      throw new Error('No mirror target configured (set CODEBERG_TOKEN/CODEBERG_REPO or GITLAB_TOKEN/GITLAB_PROJECT)');
    }
    return {
      dryRun,
      skipped: true,
      reason: 'no_mirror_configured',
      files,
      plans: [],
    };
  }

  const plans = targets.map((target) =>
    target.provider === 'codeberg'
      ? buildCodebergMirrorPlan({
          baseUrl: target.baseUrl,
          repo: target.repo,
          version,
          files,
        })
      : buildGitlabMirrorPlan({
          baseUrl: target.baseUrl,
          project: target.project,
          version,
          files,
        }),
  );

  if (dryRun) {
    return {
      dryRun: true,
      skipped: false,
      files,
      plans,
    };
  }

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const plan = plans[i];
    if (target.provider === 'codeberg') {
      results.push(await mirrorToCodeberg({ dir, plan, token: target.token, fetchFn }));
    } else {
      results.push(await mirrorToGitlab({ dir, plan, token: target.token, fetchFn }));
    }
  }

  return {
    dryRun: false,
    skipped: false,
    files,
    plans,
    results,
  };
}

function readDefaultPackageVersion() {
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch {
    // Fall back to 0.1.0
  }
  return '0.1.0';
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    dryRun: false,
    requireConfig: false,
    dir: path.resolve(process.cwd(), 'release-assets'),
    version: readDefaultPackageVersion(),
    provider: 'all',
    codebergRepo: null,
    codebergUrl: null,
    gitlabProject: null,
    gitlabUrl: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--require-config') {
      opts.requireConfig = true;
    } else if (arg === '--dir' && argv[i + 1]) {
      opts.dir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--version' && argv[i + 1]) {
      opts.version = argv[++i];
    } else if (arg === '--provider' && argv[i + 1]) {
      const value = argv[++i];
      if (!['all', 'codeberg', 'gitlab'].includes(value)) {
        throw new Error(`Invalid mirror provider '${value}' (expected all, codeberg, or gitlab)`);
      }
      opts.provider = value;
    } else if (arg === '--codeberg-repo' && argv[i + 1]) {
      opts.codebergRepo = argv[++i];
    } else if (arg === '--codeberg-url' && argv[i + 1]) {
      opts.codebergUrl = argv[++i];
    } else if (arg === '--gitlab-project' && argv[i + 1]) {
      opts.gitlabProject = argv[++i];
    } else if (arg === '--gitlab-url' && argv[i + 1]) {
      opts.gitlabUrl = argv[++i];
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return opts;
}

export function printHelp() {
  console.log(`PULSO Tor Censorship-Resistant Release Mirror Tool

Usage:
  node scripts/mirror-release.mjs [options]

Options:
  --dir <dir>                Directory containing release assets (default: release-assets)
  --version <semver>         Release version (default: package.json version)
  --provider <all|codeberg|gitlab>  Mirror provider selection (default: all)
  --codeberg-repo <owner/repo>      Override CODEBERG_REPO
  --codeberg-url <url>              Override CODEBERG_URL (default: https://codeberg.org)
  --gitlab-project <path|id>        Override GITLAB_PROJECT
  --gitlab-url <url>                Override GITLAB_URL (default: https://gitlab.com)
  --require-config           Fail instead of skipping when no mirror token/repo is set
  --dry-run                  Print mirror plan and filtered PULSO Tor files without HTTP calls
  -h, --help                 Show this help message`);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const result = await mirrorRelease({
    dir: opts.dir,
    version: opts.version,
    provider: opts.provider,
    codebergRepo: opts.codebergRepo,
    codebergUrl: opts.codebergUrl,
    gitlabProject: opts.gitlabProject,
    gitlabUrl: opts.gitlabUrl,
    dryRun: opts.dryRun,
    requireConfig: opts.requireConfig,
  });

  const prefix = opts.dryRun ? '[dry-run] ' : '';
  if (result.skipped) {
    console.log(`${prefix}Mirror skipped (${result.reason}).`);
    return;
  }

  console.log(`${prefix}Selected Tor mirror files (${result.files.length}): ${result.files.join(', ') || '(none)'}`);
  for (const plan of result.plans) {
    console.log(`${prefix}Mirror target: ${plan.provider} -> ${plan.releaseCreateUrl} (${plan.tagName})`);
  }
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
