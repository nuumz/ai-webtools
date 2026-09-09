/** Shared contract between the Side Panel, the bridge and the MAIN-world interceptor. */
import { DEFAULT_REDACT_KEYS } from './capture';

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
  /** Higher wins. Equal priorities keep insertion order. */
  priority?: number;
  /** Restricts the rule to matching origins; empty/absent means every origin. */
  scope?: { origins?: string[] };
}

export interface FormFillField {
  selector: string;
  value: string;
}

/** Global switches. `enabled` is the master kill switch for all interception. */
export interface Settings {
  enabled: boolean;
  captureEnabled: boolean;
  redactKeys: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  captureEnabled: false,
  redactKeys: DEFAULT_REDACT_KEYS,
};

/** What the bridge pushes into the MAIN world on every change. */
export interface PageConfig {
  version: 2;
  settings: Settings;
  rules: MutationRule[];
}

export interface StoredState {
  settings: Settings;
  mutationRules: MutationRule[];
  formFillFields: FormFillField[];
}

export const STORAGE_KEYS = {
  rules: 'mutationRules',
  formFill: 'formFillFields',
  settings: 'settings',
} as const;

/** MAIN <-> ISOLATED world handshake events. */
export const SYNC_EVENT = '__DEV_TOOL_SYNC_RULES__';
export const REQUEST_EVENT = '__DEV_TOOL_REQUEST_RULES__';
/** MAIN -> ISOLATED: a batch of captured exchanges, as a JSON string. */
export const CAPTURE_EVENT = '__DEV_TOOL_CAPTURE__';

export const DEFAULT_FORM_FILL_FIELDS: FormFillField[] = [
  { selector: '#email', value: 'tester@dev.local' },
  { selector: '#firstName', value: 'QA' },
  { selector: '#role', value: 'Manager' },
];
