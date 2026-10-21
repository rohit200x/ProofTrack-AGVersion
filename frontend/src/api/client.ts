import type {
  ActivityResponse,
  AppSettings,
  CsvImportResult,
  DashboardAttention,
  DashboardSummary,
  Delivery,
  DeliveryEvent,
  DriverBrief,
  Page,
  Proof,
  User,
} from "../types";

const CSRF_STORAGE_KEY = "pt_csrf_token";

let csrfTokenMemory: string | null =
  typeof sessionStorage !== "undefined" ? sessionStorage.getItem(CSRF_STORAGE_KEY) : null;

export function setCsrfToken(token: string | null) {
  csrfTokenMemory = token;
  if (typeof sessionStorage !== "undefined") {
    if (token) {
      sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  }
}

export function getCsrfToken(): string | null {
  return csrfTokenMemory;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    status: number,
    code = "API_ERROR",
    details?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfTokenMemory) return csrfTokenMemory;
  try {
    const res = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setCsrfToken(data.csrf_token);
      return data.csrf_token;
    }
  } catch {
    // ignore network error
  }
  return null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = await ensureCsrfToken();
    if (token) {
      headers.set("X-CSRF-Token", token);
    }
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    let errCode = "HTTP_ERROR";
    let errDetails: Array<{ field: string; message: string }> | undefined;
    try {
      const errJson = await res.json();
      if (errJson?.error) {
        errMsg = errJson.error.message || errMsg;
        errCode = errJson.error.code || errCode;
        errDetails = errJson.error.details;
      }
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(errMsg, res.status, errCode, errDetails);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export function uploadMultipartWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const token = await ensureCsrfToken();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path, true);
    xhr.withCredentials = true;
    if (token) {
      xhr.setRequestHeader("X-CSRF-Token", token);
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      let json: any = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(json as T);
      } else {
        const msg = json?.error?.message || `Upload failed (${xhr.status})`;
        const code = json?.error?.code || "UPLOAD_ERROR";
        const details = json?.error?.details;
        reject(new ApiError(msg, xhr.status, code, details));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError("Network connection interrupted during upload.", 0, "NETWORK_ERROR"));
    };

    xhr.send(formData);
  });
}

function toQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      sp.set(k, String(v));
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

export const api = {
  auth: {
    login: async (email: string, password: string) => {
      const res = await apiRequest<{ user: User; csrf_token: string }>(
        "/api/v1/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }
      );
      setCsrfToken(res.csrf_token);
      return res;
    },
    logout: async () => {
      try {
        await apiRequest("/api/v1/auth/logout", { method: "POST" });
      } finally {
        setCsrfToken(null);
      }
    },
    me: async () => {
      const user = await apiRequest<User>("/api/v1/auth/me");
      await ensureCsrfToken();
      return user;
    },
    changePassword: (current_password: string, new_password: string) =>
      apiRequest<{ message: string }>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password }),
      }),
  },

  dashboard: {
    summary: (params?: { date_from?: string; date_to?: string }) =>
      apiRequest<DashboardSummary>(
        `/api/v1/dashboard/summary${toQueryString(params || {})}`
      ),
    attention: (limit = 8) =>
      apiRequest<DashboardAttention>(`/api/v1/dashboard/attention?limit=${limit}`),
    activity: (params?: { limit?: number; offset?: number; event_type?: string }) =>
      apiRequest<ActivityResponse>(
        `/api/v1/dashboard/activity${toQueryString(params || {})}`
      ),
  },

  deliveries: {
    list: (params: Record<string, unknown> = {}) =>
      apiRequest<Page<Delivery>>(`/api/v1/deliveries${toQueryString(params)}`),
    get: (id: string) => apiRequest<Delivery>(`/api/v1/deliveries/${id}`),
    create: (data: Record<string, unknown>) =>
      apiRequest<Delivery>("/api/v1/deliveries", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    assign: (
      id: string,
      payload: { driver_id: string; scheduled_date?: string; reason?: string }
    ) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}/assign`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    unassign: (id: string) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}/unassign`, {
        method: "POST",
      }),
    start: (id: string) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}/start`, {
        method: "POST",
      }),
    complete: (
      id: string,
      formData: FormData,
      onProgress?: (percent: number) => void
    ) =>
      uploadMultipartWithProgress<Delivery>(
        `/api/v1/deliveries/${id}/complete`,
        formData,
        onProgress
      ),
    fail: (
      id: string,
      formData: FormData,
      onProgress?: (percent: number) => void
    ) =>
      uploadMultipartWithProgress<Delivery>(
        `/api/v1/deliveries/${id}/fail`,
        formData,
        onProgress
      ),
    reopen: (
      id: string,
      payload: { reason: string; driver_id?: string | null; scheduled_date?: string }
    ) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}/reopen`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    cancel: (id: string, reason?: string) =>
      apiRequest<Delivery>(`/api/v1/deliveries/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    events: (id: string) =>
      apiRequest<DeliveryEvent[]>(`/api/v1/deliveries/${id}/events`),
    proofs: (id: string) =>
      apiRequest<Proof[]>(`/api/v1/deliveries/${id}/proofs`),
    importCsv: (
      file: File,
      options: { dry_run?: boolean; allow_partial?: boolean } = {}
    ) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiRequest<CsvImportResult>(
        `/api/v1/deliveries/import${toQueryString(options)}`,
        {
          method: "POST",
          body: fd,
        }
      );
    },
    exportUrl: (params: Record<string, unknown> = {}) =>
      `/api/v1/deliveries/export${toQueryString(params)}`,
    templateUrl: () => "/api/v1/deliveries/import-template",
  },

  driver: {
    deliveries: (params: {
      date?: string;
      status?: string;
      search?: string;
      include_overdue?: boolean;
    } = {}) =>
      apiRequest<Delivery[]>(`/api/v1/driver/deliveries${toQueryString(params)}`),
    history: (page = 1, page_size = 25) =>
      apiRequest<Page<Delivery>>(
        `/api/v1/driver/history?page=${page}&page_size=${page_size}`
      ),
  },

  proofs: {
    thumbnailUrl: (proofId: string) => `/api/v1/proofs/${proofId}/thumbnail`,
    previewUrl: (proofId: string) => `/api/v1/proofs/${proofId}/preview`,
    originalUrl: (proofId: string, download = false) =>
      `/api/v1/proofs/${proofId}/original${download ? "?download=true" : ""}`,
    flag: (proofId: string, reason: string) =>
      apiRequest<Proof>(`/api/v1/proofs/${proofId}/flag`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    resolve: (proofId: string, reason: string) =>
      apiRequest<Proof>(`/api/v1/proofs/${proofId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    delete: (proofId: string, reason: string) =>
      apiRequest<{ message: string }>(`/api/v1/proofs/${proofId}`, {
        method: "DELETE",
        body: JSON.stringify({ reason }),
      }),
  },

  users: {
    list: (params: {
      role?: string;
      is_active?: boolean;
      search?: string;
      page?: number;
      page_size?: number;
    } = {}) => apiRequest<Page<User>>(`/api/v1/users${toQueryString(params)}`),
    create: (data: Record<string, unknown>) =>
      apiRequest<User>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      apiRequest<User>(`/api/v1/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    resetPassword: (id: string, new_password: string) =>
      apiRequest<{ message: string }>(`/api/v1/users/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ new_password }),
      }),
    drivers: (active_only = true) =>
      apiRequest<DriverBrief[]>(`/api/v1/drivers?active_only=${active_only}`),
  },

  settings: {
    get: () => apiRequest<AppSettings>("/api/v1/settings"),
    update: (data: Partial<AppSettings>) =>
      apiRequest<AppSettings>("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    reconcileStorage: () =>
      apiRequest<Record<string, number>>("/api/v1/settings/reconcile-storage", {
        method: "POST",
      }),
  },
};
