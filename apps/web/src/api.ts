export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      // Cabecera exigida por el servidor como defensa CSRF.
      "x-requested-with": "oblivion",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Error ${res.status}`, res.status);
  return data as T;
}

/** Sube un archivo binario tal cual (la foto de fondo). */
async function upload<T>(path: string, blob: Blob): Promise<T> {
  const res = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": blob.type || "application/octet-stream", "x-requested-with": "oblivion" },
    body: blob,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Error ${res.status}`, res.status);
  return data as T;
}

export const api = {
  upload,
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b: unknown) => request<T>("PATCH", p, b),
  del: <T>(p: string) => request<T>("DELETE", p),
};
