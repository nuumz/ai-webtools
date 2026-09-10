/** Port names and message contracts for page ↔ service worker ↔ panel. */
import type { BodySnapshot, CapturedExchange, ExchangeMeta } from './capture';

/** Opened by the ISOLATED bridge; `port.sender` gives the SW tabId/frameId/url for free. */
export const PORT_PAGE = 'devtool.page';
/** Opened by the side panel. */
export const PORT_PANEL = 'devtool.panel';

export type PageToBg =
  /**
   * `fresh` separates a new document from a mere port reconnect: the worker is
   * terminated whenever it goes idle, and re-opening that port must not read as
   * a navigation, or the tab's log is thrown away while the page is still live.
   */
  | { kind: 'page/hello'; url: string; isTop: boolean; fresh: boolean }
  | { kind: 'capture/exchange'; exchanges: CapturedExchange[] }
  | { kind: 'capture/dropped'; count: number };

export type PanelToBg =
  /** `tabId` is the tab that opened the panel and the only one we arm. */
  | { kind: 'log/subscribe'; tabId?: number; windowId?: number }
  /** Traffic alone can leave the worker idle long enough to be killed mid-recording. */
  | { kind: 'panel/ping' }
  | { kind: 'log/clear' }
  | { kind: 'log/getBody'; exchangeId: string }
  /** Record on/off for the panel's pinned tab only. */
  | { kind: 'log/record'; enabled: boolean };

/** Service worker → page bridge: this tab is (or is no longer) the panel's tab. */
export type BgToPage = { kind: 'page/armed'; armed: boolean; recording: boolean };

export type BgToPanel =
  | { kind: 'tab/changed'; tabId: number; url?: string; pinned: boolean }
  /** The pinned tab is gone: the panel keeps its log but can no longer act. */
  | { kind: 'tab/closed'; tabId: number }
  | { kind: 'tab/recording'; tabId: number; recording: boolean }
  /**
   * Whether any content script in the tab is talking to the worker. A tab that
   * was open before the extension — or one Chrome refuses to script — records
   * nothing, and without this the panel cannot tell that from "no traffic yet".
   */
  | { kind: 'tab/pages'; tabId: number; connected: boolean }
  | { kind: 'log/reset'; tabId: number; entries: ExchangeMeta[]; dropped: number }
  | { kind: 'log/append'; tabId: number; entries: ExchangeMeta[]; dropped: number }
  | {
      kind: 'log/body';
      exchangeId: string;
      found: boolean;
      request?: BodySnapshot;
      response?: BodySnapshot;
    };
