/** Port names and message contracts for page ↔ service worker ↔ panel. */
import type { BodySnapshot, CapturedExchange, ExchangeMeta } from './capture';

/** Opened by the ISOLATED bridge; `port.sender` gives the SW tabId/frameId/url for free. */
export const PORT_PAGE = 'devtool.page';
/** Opened by the side panel. */
export const PORT_PANEL = 'devtool.panel';

export type PageToBg =
  | { kind: 'page/hello'; url: string; isTop: boolean }
  | { kind: 'capture/exchange'; exchanges: CapturedExchange[] }
  | { kind: 'capture/dropped'; count: number };

export type PanelToBg =
  /** `tabId` pins the panel to the tab it was opened from; `windowId` is the
   *  unpinned fallback (follow whichever tab is active in that window). */
  | { kind: 'log/subscribe'; tabId?: number; windowId?: number }
  | { kind: 'log/clear' }
  | { kind: 'log/getBody'; exchangeId: string };

export type BgToPanel =
  | { kind: 'tab/changed'; tabId: number; url?: string; pinned: boolean }
  /** The pinned tab is gone: the panel keeps its log but can no longer act. */
  | { kind: 'tab/closed'; tabId: number }
  | { kind: 'log/reset'; tabId: number; entries: ExchangeMeta[]; dropped: number }
  | { kind: 'log/append'; tabId: number; entries: ExchangeMeta[]; dropped: number }
  | {
      kind: 'log/body';
      exchangeId: string;
      found: boolean;
      request?: BodySnapshot;
      response?: BodySnapshot;
    };
