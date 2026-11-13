/** What the node writes on every item when the archive did not happen and the workflow goes on. */
export interface LockerFailure {
  archived: false;
  reason: string;
  code: string;
  retryable: boolean;
  status?: number;
}

/** The ProblemDetails shape the API answers with; the code rides in `title`, as the FlurryPORT CLI reads it. */
export interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  Error?: string;
}

/** Wording per the n8n UX guidelines: what happened, then how to fix it; no "error", "problem", "failure". */
export function describeFailure(status: number | undefined, body: ProblemDetails | undefined): LockerFailure {
  const code = body?.title ?? body?.Error ?? (status ? `http_${status}` : 'network');
  const detail = body?.detail ?? '';
  switch (status) {
    case 400:
      return { archived: false, code, status, retryable: false, reason: `Locker did not accept the run document. ${detail}`.trim() };
    case 401:
    case 403:
      return { archived: false, code, status, retryable: false, reason: 'Locker did not accept the install key. Paste the key from the install page in FlurryPORT into the credential.' };
    case 404:
      return { archived: false, code, status, retryable: false, reason: 'Locker did not find the install. Check the API base URL in the credential.' };
    case 409:
      return { archived: false, code, status, retryable: false, reason: `A run with this id was archived with a different document. ${detail}`.trim() };
    case 410:
      return { archived: false, code, status, retryable: false, reason: 'This install was removed in FlurryPORT; create a new one and paste its key.' };
    case 413:
      return { archived: false, code, status, retryable: false, reason: 'The run document is over 1 MB even as a stub.' };
    case 429:
      return { archived: false, code, status, retryable: true, reason: 'Locker is pacing this install. The next run goes through; this one was not kept.' };
    case undefined:
      return { archived: false, code, retryable: true, reason: 'Locker could not be reached. Check the API base URL and the network, then run again.' };
    default:
      return { archived: false, code, status, retryable: status >= 500, reason: status >= 500 ? 'Locker answered with a server condition; run again in a moment.' : `Locker answered ${status}. ${detail}`.trim() };
  }
}

/** The seconds to wait from a Retry-After header, bounded at 30. */
export function retryAfterSeconds(header: string | undefined): number {
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 30);
  return 5;
}
