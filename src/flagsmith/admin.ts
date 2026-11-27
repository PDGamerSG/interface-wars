// Minimal Flagsmith Admin (Management) API client used by the lab, the verifier and the experiment control plane.
// Auth is either a user token ("Token ...") or an organisation master API key ("Api-Key ...").

export type Credential = { kind: 'token' | 'api-key'; value: string };

export class FlagsmithError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type Admin = {
  baseUrl: string;
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
  list<T = any>(path: string): Promise<T[]>;
};

export function createAdmin(baseUrl: string, credential: Credential): Admin {
  const root = baseUrl.replace(/\/+$/, '');
  const auth = (credential.kind === 'token' ? 'Token ' : 'Api-Key ') + credential.value;

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const url = path.startsWith('http') ? path : root + path;
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            authorization: auth,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        const text = await response.text();
        if (response.status >= 500 || response.status === 429) {
          lastError = new FlagsmithError(`${method} ${path} -> ${response.status}`, response.status, text);
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        if (!response.ok) {
          throw new FlagsmithError(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`, response.status, text);
        }
        return text ? JSON.parse(text) : null;
      } catch (error) {
        if (error instanceof FlagsmithError && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  return {
    baseUrl: root,
    get: (path) => call('GET', path),
    post: (path, body = {}) => call('POST', path, body),
    put: (path, body = {}) => call('PUT', path, body),
    patch: (path, body = {}) => call('PATCH', path, body),
    del: async (path) => {
      await call('DELETE', path);
    },
    async list(path) {
      const items: any[] = [];
      let next: string | null = path + (path.includes('?') ? '&' : '?') + 'page_size=999';
      while (next) {
        const page: any = await call('GET', next);
        if (Array.isArray(page)) return page;
        items.push(...(page.results ?? []));
        next = page.next ? String(page.next).replace(/^https?:\/\/[^/]+/, '') : null;
      }
      return items;
    },
  };
}

// Anonymous helper for signup/login, which take no credential.
export async function anonymousPost(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(baseUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new FlagsmithError(`POST ${path} -> ${response.status}: ${text.slice(0, 300)}`, response.status, text);
  return text ? JSON.parse(text) : null;
}
