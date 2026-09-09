/** Shared contract between the Side Panel, the bridge and the MAIN-world interceptor. */

export type RuleType = 'MUTATE_REQUEST' | 'MUTATE_RESPONSE' | 'STUB';

export type HttpMethod = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface MutationRule {
  id: string;
  isActive: boolean;
  type: RuleType;
  /**
   * URLPattern-ish matcher:
   *  - `https://api.example.com/v1/*`  → matched as a full URLPattern
   *  - `/api/v1/users/*`               → matched against the pathname only
   *  - `users`                         → substring match against the whole URL
   */
  urlPattern: string;
  method: HttpMethod;
  /** JSON deep-merged into the request body / response body, or returned as-is for STUB. */
  payload: unknown;
  /** Status code used by STUB responses. Defaults to 200. */
  status?: number;
  label?: string;
}

export interface FormFillField {
  selector: string;
  value: string;
}

export interface StoredState {
  mutationRules: MutationRule[];
  formFillFields: FormFillField[];
}

export const STORAGE_KEYS = {
  rules: 'mutationRules',
  formFill: 'formFillFields',
} as const;

/** MAIN <-> ISOLATED world handshake events. */
export const SYNC_EVENT = '__DEV_TOOL_SYNC_RULES__';
export const REQUEST_EVENT = '__DEV_TOOL_REQUEST_RULES__';

export const DEFAULT_FORM_FILL_FIELDS: FormFillField[] = [
  { selector: '#email', value: 'tester@dev.local' },
  { selector: '#firstName', value: 'QA' },
  { selector: '#role', value: 'Manager' },
];
