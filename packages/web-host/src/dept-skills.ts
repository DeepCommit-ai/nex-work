/**
 * [ENTERPRISE PATCH] 部门技能写盘桥 —— cynapse issue #14 / #16。
 *
 * ## 为什么存在
 *
 * 技能薄壳由 cynapse `/config` 下发，客户端落实时要写进 aioncore 的
 * `<dataDir>/builtin-skills/<技能名>/SKILL.md`（aioncore 每会话把这棵子树物化进
 * 工作区 `.claude/skills/`，实测通道）。renderer 自己够不到盘，而 aioncore 的
 * 通用写口不够用（实测 2026-08-29）：
 *
 * - `POST /api/fs/write` 不建父目录（"cannot resolve parent"）——新装机器上
 *   `builtin-skills/<名>/` 一定不存在，首次写必败；
 * - 没有任何删除口——退役 `~/.nexwork-claude/skills/` 的手工技能包做不了；
 * - 它是**任意绝对路径**的写口，"只许写 builtin-skills 子树"的边界只能靠调用方自律。
 *
 * 所以要一个跑在宿主机上、知道 dataDir 的**受限**写口：写死只碰两棵子树，
 * 越权路径在入口内部拒绝，而不是指望每个调用方都拼对路径。
 *
 * ## 两个通道，一份核心（issue #16）
 *
 * - **HTTP**（webui）：`handleDeptSkillsRequest`，挂在 web-host static-server 的
 *   `/host-api/dept-skills/*`。桌面形态的 renderer 直连 aioncore，够不到它。
 * - **IPC**（Electron 桌面）：`handleDeptSkillsIpcCall`，由桌面主进程的 bridge
 *   provider 直调（`enterprise.dept-skills` 通道）。
 *
 * 白名单、resolve 前缀守卫、幂等比对、错误码全部在 `performDeptSkillAction`
 * 这一份里；通道层只允许存在传输差异（HTTP 的 405/请求体上限/JSON 解析，
 * IPC 的信封直返）。守卫逻辑绝不复制两份——复制的那份必然漂移。
 *
 * ## 安全边界
 *
 * HTTP 侧认证与 `/api/*` 反代同层（static-server 不做独立认证）。这不扩大攻击面：
 * 能打到本端点的调用方同样能打到 aioncore 的 `/api/fs/write`（任意路径写），而本
 * 端点只允许两个白名单动作。IPC 侧同理：能发 bridge 事件的 renderer 也能直打
 * aioncore HTTP 面。技能名是唯一的路径输入，白名单正则 + resolve 前缀双保险，
 * 两通道进的是同一道门。
 *
 * ## 失败姿态
 *
 * 与 aioncore 同构的信封：`{success:true,data}` / `{success:false,error,code}`，
 * renderer 两通道无需特判。所有拒绝都带 code，绝不静默吞掉。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * 技能名白名单：小写字母/数字/连字符，≤64 字符。与 cynapse 服务端 validate 同一
 * 条正则——技能名会成为路径段，带 `/`、`..`、`~` 的"技能名"就是目录穿越。
 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isValidSkillName = (name: unknown): name is string => typeof name === 'string' && SKILL_NAME_RE.test(name);

/** SKILL.md 的体积上限。薄壳只有几十行；没有上限时一次调用就能写满盘。 */
export const MAX_SKILL_BYTES = 256 * 1024;

/** HTTP 请求体上限（略高于内容上限，容 JSON 包装）。 */
const MAX_BODY_BYTES = MAX_SKILL_BYTES + 4 * 1024;

export type DeptSkillsContext = {
  /** aioncore 的 dataDir；`<dataDir>/builtin-skills/` 是唯一可写子树。 */
  dataDir?: string;
  /**
   * 受管 Claude 的隔离目录（retire 的作用域）。测试注入用；生产不传 =
   * `~/.nexwork-claude`——与 deptConfigService 的 DEFAULT_CONFIG_DIR、服务端
   * 下发的 gateway.config_dir 同一默认值。写死而不是从请求体拿：删除路径
   * 绝不能是调用方输入。
   */
  managedConfigDir?: string;
};

/** 两通道同构的响应信封（与 aioncore 的 `/api/*` 信封一致）。 */
export type DeptSkillsEnvelope =
  | { success: true; data: { changed: boolean } | { removed: boolean } }
  | { success: false; error: string; code: string };

/** 核心动作的结果：信封 + HTTP 通道用的状态码（IPC 通道丢弃 httpStatus）。 */
export type DeptSkillsActionResult = { httpStatus: number; body: DeptSkillsEnvelope };

const ok = (data: { changed: boolean } | { removed: boolean }): DeptSkillsActionResult => ({
  httpStatus: 200,
  body: { success: true, data },
});

const reject = (httpStatus: number, code: string, error: string): DeptSkillsActionResult => ({
  httpStatus,
  body: { success: false, error, code },
});

/**
 * 解析出目标 SKILL.md 的绝对路径，或 null（越权/非法名）。
 *
 * 正则已经排除了路径分隔符与 `..`，resolve 前缀是第二道保险——两道各自独立成立，
 * 一道被将来的重构弄坏时另一道仍然兜底。
 */
export const resolveSkillFile = (dataDir: string, name: string): string | null => {
  if (!isValidSkillName(name)) return null;
  const root = path.resolve(dataDir, 'builtin-skills');
  const target = path.resolve(root, name, 'SKILL.md');
  if (!target.startsWith(root + path.sep)) return null;
  return target;
};

/** retire 的目标目录，或 null。作用域写死在 managedConfigDir/skills 之下。 */
export const resolveRetireDir = (managedConfigDir: string, name: string): string | null => {
  if (!isValidSkillName(name)) return null;
  const root = path.resolve(managedConfigDir, 'skills');
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) return null;
  return target;
};

/**
 * 写盘/退役的**唯一**核心实现——HTTP 桥与 Electron IPC 通道都进这道门。
 *
 * 自身永不 throw：所有失败（含 fs 异常）收敛成带 code 的失败信封。
 * 通道层拿到的永远是"已定型"的结果，没有第二套错误语义可分叉。
 */
export function performDeptSkillAction(
  action: unknown,
  payload: { name?: unknown; content?: unknown },
  ctx: DeptSkillsContext
): DeptSkillsActionResult {
  if (action !== 'write' && action !== 'retire') {
    return reject(404, 'UNKNOWN_ACTION', `没有这个动作：${String(action)}`);
  }
  if (!isValidSkillName(payload.name)) {
    // 名字就是路径段：非法名不是"参数错误"是越权尝试，日志里响一声。
    console.warn(`[dept-skills] 拒绝非法技能名：${JSON.stringify(payload.name)?.slice(0, 80)}`);
    return reject(400, 'BAD_SKILL_NAME', '技能名只允许小写字母/数字/连字符，≤64 字符');
  }
  const name = payload.name;

  try {
    if (action === 'write') {
      if (!ctx.dataDir?.trim()) {
        // 没有 dataDir 时不能猜一个：写错子树比写失败更难排查。
        return reject(503, 'HOST_DATA_DIR_UNAVAILABLE', 'web-host 未配置 dataDir，技能写盘不可用');
      }
      if (typeof payload.content !== 'string' || !payload.content.trim()) {
        return reject(400, 'BAD_CONTENT', 'content 必须是非空字符串（SKILL.md 全文）');
      }
      if (Buffer.byteLength(payload.content, 'utf8') > MAX_SKILL_BYTES) {
        return reject(413, 'CONTENT_TOO_LARGE', `SKILL.md 超过 ${MAX_SKILL_BYTES} 字节`);
      }
      const target = resolveSkillFile(ctx.dataDir, name);
      if (!target) {
        return reject(400, 'BAD_SKILL_NAME', '技能名解析越出 builtin-skills 子树');
      }
      // 幂等：内容一致不落笔。全量重放每次启动都跑，无变化的写只会白刷 mtime、
      // 扩大失败面（且让"这台机器的技能被谁改过"无从查起）。
      let existing: string | null = null;
      try {
        existing = fs.readFileSync(target, 'utf8');
      } catch {
        /* 不存在 = 要写 */
      }
      if (existing === payload.content) {
        return ok({ changed: false });
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, payload.content, 'utf8');
      console.info(`[dept-skills] 已写入技能 ${name}（${existing === null ? '新建' : '更新'}）`);
      return ok({ changed: true });
    }

    // retire：删除受管 Claude 全局技能目录里的同名手工技能包（双源退役）。
    // 机器级技能对**所有助手**可见，会让默认助手蹭到企业技能、破坏按助手隔离。
    const configDir = ctx.managedConfigDir?.trim() || path.join(os.homedir(), '.nexwork-claude');
    const target = resolveRetireDir(configDir, name);
    if (!target) {
      return reject(400, 'BAD_SKILL_NAME', '技能名解析越出受管 skills 子树');
    }
    if (!fs.existsSync(target)) {
      return ok({ removed: false });
    }
    fs.rmSync(target, { recursive: true, force: true });
    console.info(`[dept-skills] 已退役受管全局技能 ${name}（${target}）`);
    return ok({ removed: true });
  } catch (e) {
    return reject(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
  }
}

// ── HTTP 通道（web-host static-server，webui 形态）───────────────────────────

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const fail = (res: ServerResponse, status: number, code: string, error: string): void =>
  json(res, status, { success: false, error, code });

const readBody = (req: IncomingMessage): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (v: Buffer | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        done(null); // 超限：不再积攒，让调用方回 413
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', () => done(null));
  });

/**
 * 处理 `/host-api/dept-skills/*`。命中路径前缀时返回 true（无论成败，响应已发）；
 * 不是本桥的路径返回 false，调用方继续走反代/静态分支。
 */
export async function handleDeptSkillsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: DeptSkillsContext
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/host-api/dept-skills/')) return false;

  if (req.method !== 'POST') {
    fail(res, 405, 'METHOD_NOT_ALLOWED', '只接受 POST');
    return true;
  }
  const action = url.slice('/host-api/dept-skills/'.length);
  if (action !== 'write' && action !== 'retire') {
    // 未知动作不读 body（不给未知动作读流的机会）。拒绝语义仍由核心给出——
    // 消息只活在一处，两通道的 UNKNOWN_ACTION 永远同字节。
    const unknown = performDeptSkillAction(action, {}, ctx);
    json(res, unknown.httpStatus, unknown.body);
    return true;
  }

  const raw = await readBody(req);
  if (raw === null) {
    fail(res, 413, 'BODY_TOO_LARGE', `请求体超过 ${MAX_BODY_BYTES} 字节或读取失败`);
    return true;
  }
  let body: { name?: unknown; content?: unknown };
  try {
    body = JSON.parse(raw.toString('utf8')) as typeof body;
  } catch {
    fail(res, 400, 'BAD_JSON', '请求体不是合法 JSON');
    return true;
  }

  const result = performDeptSkillAction(action, body, ctx);
  json(res, result.httpStatus, result.body);
  return true;
}

// ── IPC 通道（Electron 桌面主进程，issue #16）────────────────────────────────

/** IPC 载荷。字段全 unknown：校验权在主进程侧的核心，不信任 renderer 的类型。 */
export type DeptSkillsIpcPayload = { action?: unknown; name?: unknown; content?: unknown };

/**
 * Electron IPC 通道入口（桌面主进程的 bridge provider 直调）。
 *
 * 与 HTTP 通道同一核心、同构信封，renderer 两通道共用同一套错误处理。
 * **绝不 throw**：bridge 的 invoke 对 throw 的 provider 永远不回包，renderer
 * 会无声挂死在 pending——所有失败都必须收敛进失败信封（core 已兜底，这里再
 * 兜一层是 IPC 通道的硬约束，不是防御性装饰）。
 */
export function handleDeptSkillsIpcCall(payload: DeptSkillsIpcPayload, ctx: DeptSkillsContext): DeptSkillsEnvelope {
  try {
    return performDeptSkillAction(payload?.action, { name: payload?.name, content: payload?.content }, ctx).body;
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), code: 'INTERNAL_ERROR' };
  }
}
