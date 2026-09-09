/** Node-only, offline skill corpus for the pinned backend. */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import upstream from './upstream.json';
import { brandToolText, renameSkill, SKILL_NAMES } from './policy';

const applicationGuides: Record<string, string> = {
  'nexwork-troubleshooting': `---
name: nexwork-troubleshooting
description: Diagnose NexWork desktop, department connection, assistant, and tool problems when the employee asks for help.
---
# NexWork troubleshooting
Start with the reported problem and read-only evidence. Check the current application state, relevant logs, and the affected tool's actual error. Do not expose department keys, model credentials, or private documents.
Employees connect in the enterprise connection settings using the configuration service address and department key supplied by their organization. Do not ask them to install agent CLIs, create personal model accounts, or replace managed configuration.
Use the available configuration helper's capabilities command before choosing a diagnostic command. Keep its runtime-provided environment intact. Preserve conversations and user files. Ask before a destructive repair; do not reset settings or disable tools merely to suppress an error.
If administrator action is required, explain the measured failure and the specific information their organization needs. Do not invent an official support URL.
`,
  'nexwork-webui-setup': `---
name: nexwork-webui-setup
description: Help an authorized user configure NexWork remote access when explicitly requested.
---
# NexWork remote access
Use the application's remote connection settings and current runtime information. Explain authentication and the reachable address before enabling access. Preserve existing credentials and department configuration.
Do not start a product tour, install another desktop application, ask for personal model keys, or enable remote access without a request. Follow the organization's network policy. Verify the actual endpoint and authentication before claiming it works. Do not invent download or support URLs.
`,
  'nexwork-webui-public': `---
name: nexwork-webui-public
description: Review a specifically requested external-access setup for NexWork with an authorized administrator.
---
# NexWork external access
External access is an administrator-controlled option, not part of employee onboarding. Never create a public tunnel or expose an unauthenticated service automatically.
First establish the requested audience, authorization, current authenticated endpoint, and approved network method. Keep department and model keys secret. Use only available tools and verified network settings. If no approved method is supplied, explain what the administrator must provide instead of installing tunnel software or inventing an endpoint.
`,
};

/** Build branded names and prose while preserving third-party skills and wire contracts. */
export function buildNexworkSkills(): Record<string, Buffer> {
  const encoded = JSON.parse(gunzipSync(Buffer.from(upstream.gzipBase64, 'base64')).toString()) as Record<
    string,
    string
  >;
  const files: Record<string, Buffer> = {};
  for (const [relative, value] of Object.entries(encoded)) {
    const parts = relative.split('/');
    const skillIndex = parts[0] === 'auto-inject' ? 1 : 0;
    const name = renameSkill(parts[skillIndex]);
    parts[skillIndex] = name;
    if (applicationGuides[name]) continue;
    let content = Buffer.from(value, 'base64');
    if (relative.endsWith('.md')) {
      let text = brandToolText(content.toString());
      for (const [oldName, newName] of Object.entries(SKILL_NAMES)) text = text.replaceAll(oldName, newName);
      content = Buffer.from(text);
    }
    files[parts.join('/')] = content;
  }
  for (const [name, text] of Object.entries(applicationGuides)) files[`${name}/SKILL.md`] = Buffer.from(text);
  return files;
}

/** Materialize the complete corpus before backend startup, using its supported override. */
export function prepareNexworkSkills(dataDir: string): Record<string, string> {
  const files = buildNexworkSkills();
  const hash = createHash('sha256');
  for (const [name, content] of Object.entries(files)) hash.update(name).update(content);
  const root = path.join(dataDir, 'nexwork-resources', 'skills', hash.digest('hex').slice(0, 16));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid NexWork skill resource path');
    try {
      if (readFileSync(file).equals(content)) continue;
    } catch {
      /* Create or repair. */
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, file);
  }
  return { AIONUI_BUILTIN_SKILLS_PATH: root };
}
