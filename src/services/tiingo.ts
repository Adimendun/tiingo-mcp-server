// src/services/tiingo.ts
export const TIINGO_BASE = "https://api.tiingo.com";

export function getToken(): string {
  const token = process.env.TIINGO_TOKEN;
  if (!token) throw new Error("TIINGO_TOKEN environment variable is not set");
  return token;
}

export function tiingoHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Token ${getToken()}`
  };
}

export async function tiingoFetch<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const url = new URL(`${TIINGO_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { headers: tiingoHeaders() });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tiingo API error ${res.status}: ${body || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function defaultStartDate(daysBack = 365): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return formatDate(d);
}

export function todayDate(): string {
  return formatDate(new Date());
}
