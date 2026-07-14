import axios from "axios";

// baseURL = префикс развёртывания (Vite base). Так все вызовы "/api/..." уходят
// через проксируемый путь (напр. /jnserver/1109/application/api/...).
export const http = axios.create({ baseURL: import.meta.env.BASE_URL });

// --- Сессионный токен авторизации (ТЗ 3) ---
const TOKEN_KEY = "do_auth_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Ко всем запросам подставляем Bearer-токен (если пользователь вошёл).
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.detail;
      if (typeof detail === "string" && detail) {
        return Promise.reject(new Error(detail));
      }
    }
    return Promise.reject(error);
  },
);

// --- Типы (зеркало backend/app/schemas.py) ---

export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcription {
  id: string;
  filename: string;
  media_kind: string;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  language: string;
  duration: number;
  full_text: string;
  created_at: string;
  segments: Segment[];
  // Сопоставление технических меток («Спикер 1») с ФИО/должностями (ТЗ 2).
  speaker_map: Record<string, string>;
}

// --- Авторизация и роли (ТЗ 3) ---

export type Role = "admin" | "head" | "staff" | "executor";

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface MeResponse {
  auth_enabled: boolean;
  authenticated: boolean;
  user: User | null;
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  user: User;
  permissions: string[];
}

export interface TranscriptionListItem {
  id: string;
  filename: string;
  media_kind: string;
  status: string;
  duration: number;
  segments_count: number;
  created_at: string;
}

export interface Task {
  id: string;
  protocol_id: string;
  assignment: string;
  responsible: string;
  department: string;
  deadline: string;
  status: string;
  source_fragment: string;
  reason_comment: string;
  confidence: number;
  max_username: string;
  max_chat_id: string;
  completion_text: string;
  closed_at?: string | null;
  notified_at?: string | null;
  created_at: string;
}

export interface Protocol {
  id: string;
  transcription_id?: string;
  title: string;
  date: string;
  number: string;
  body: string;
  docx_path: string;
  created_at: string;
  tasks: Task[];
}

export interface ProtocolListItem {
  id: string;
  title: string;
  date: string;
  number: string;
  tasks_count: number;
  created_at: string;
}

export interface Justification {
  id: string;
  task_id: string;
  fragment: string;
  duty: string;
  text: string;
  docx_path: string;
}

export interface Citation {
  source_type: string;
  source_id: string;
  title: string;
  fragment: string;
  start?: number | null;
}

export interface QAResponse {
  session_id: string;
  answer: string;
  citations: Citation[];
}

export interface SearchHit {
  transcription_id?: string | null;
  title: string;
  fragment: string;
  score: number;
  start?: number | null;
}

export interface Library {
  protocols: ProtocolListItem[];
  transcriptions: TranscriptionListItem[];
}

export interface Health {
  status: string;
  service: string;
  ffmpeg: boolean;
  dify_app: boolean;
  dify_dataset: boolean;
  openrouter: boolean;
  asr_model: string;
  auth_required: boolean;
  max_bot: boolean;
  max_configured: boolean;
  execution_control: boolean;
  auth_enabled: boolean;
}

export type ExportFmt = "docx" | "pdf" | "md" | "txt" | "json";

// --- API ---

export const api = {
  health: () => http.get<Health>("/api/health").then((r) => r.data),

  uploadTranscription: (file: File, onProgress?: (p: number) => void) => {
    const fd = new FormData();
    fd.append("file", file);
    return http
      .post<Transcription>("/api/transcriptions", fd, {
        onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      })
      .then((r) => r.data);
  },
  createTextTranscription: (title: string, text: string) =>
    http.post<Transcription>("/api/transcriptions/text", { title, text }).then((r) => r.data),
  listTranscriptions: () =>
    http.get<TranscriptionListItem[]>("/api/transcriptions").then((r) => r.data),
  getTranscription: (id: string) =>
    http.get<Transcription>(`/api/transcriptions/${id}`).then((r) => r.data),
  // Прямой URL (для <audio src>) — с учётом префикса развёртывания. Токен
  // передаётся в query, т.к. тег <audio> не может отправить заголовок.
  mediaUrl: (id: string) => {
    const token = getToken();
    const base = `${import.meta.env.BASE_URL}api/transcriptions/${id}/media`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  updateSpeakers: (id: string, mappings: Record<string, string>) =>
    http.put<Transcription>(`/api/transcriptions/${id}/speakers`, { mappings }).then((r) => r.data),

  generateProtocol: (transcription_id: string) =>
    http.post<Protocol>("/api/protocols", { transcription_id }).then((r) => r.data),
  listProtocols: () => http.get<ProtocolListItem[]>("/api/protocols").then((r) => r.data),
  getProtocol: (id: string) => http.get<Protocol>(`/api/protocols/${id}`).then((r) => r.data),

  deleteTranscription: (id: string) =>
    http.delete(`/api/transcriptions/${id}`).then((r) => r.data),
  retryTranscription: (id: string) =>
    http.post<Transcription>(`/api/transcriptions/${id}/retry`).then((r) => r.data),
  updateSegments: (id: string, segments: Segment[]) =>
    http.put<Transcription>(`/api/transcriptions/${id}/segments`, { segments }).then((r) => r.data),

  deleteProtocol: (id: string) => http.delete(`/api/protocols/${id}`).then((r) => r.data),

  listTasks: (status?: string) =>
    http.get<Task[]>("/api/tasks", { params: { status } }).then((r) => r.data),
  updateTask: (taskId: string, patch: Partial<Task>) =>
    http.patch<Task>(`/api/tasks/${taskId}`, patch).then((r) => r.data),
  submitExecution: (taskId: string, completion_text: string) =>
    http.post<Task>(`/api/tasks/${taskId}/execution`, { completion_text }).then((r) => r.data),
  confirmTask: (taskId: string, notify_max = false) =>
    http.post<Task>(`/api/tasks/${taskId}/confirm`, { notify_max }).then((r) => r.data),
  sendTaskToMax: (taskId: string) =>
    http.post<{ ok: boolean; result: unknown }>(`/api/tasks/${taskId}/send-max`).then((r) => r.data),
  buildJustification: (taskId: string) =>
    http.post<Justification>(`/api/tasks/${taskId}/justification`).then((r) => r.data),

  ask: (question: string, scope: { protocol_ids: string[]; transcription_ids: string[] }, session_id?: string) =>
    http.post<QAResponse>("/api/qa", { question, scope, session_id }).then((r) => r.data),

  search: (query: string, top_k = 8) =>
    http.post<{ hits: SearchHit[] }>("/api/search", { query, top_k }).then((r) => r.data.hits),

  library: () => http.get<Library>("/api/library").then((r) => r.data),

  exportObject: (object_type: string, object_id: string, fmt: ExportFmt) =>
    http
      .post("/api/export", { object_type, object_id, fmt }, { responseType: "blob" })
      .then((r) => r.data as Blob),

  // --- Авторизация / пользователи (ТЗ 3) ---
  me: () => http.get<MeResponse>("/api/auth/me").then((r) => r.data),
  login: (username: string, password: string) =>
    http.post<LoginResponse>("/api/auth/login", { username, password }).then((r) => r.data),
  logout: () => http.post("/api/auth/logout").then((r) => r.data),
  listUsers: () => http.get<User[]>("/api/auth/users").then((r) => r.data),
  createUser: (body: { username: string; password: string; full_name: string; role: Role }) =>
    http.post<User>("/api/auth/users", body).then((r) => r.data),
  updateUser: (id: string, patch: Partial<{ full_name: string; role: Role; password: string; is_active: boolean }>) =>
    http.patch<User>(`/api/auth/users/${id}`, patch).then((r) => r.data),
  deleteUser: (id: string) => http.delete(`/api/auth/users/${id}`).then((r) => r.data),
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
