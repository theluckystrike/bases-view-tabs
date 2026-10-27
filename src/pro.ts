import type { SponsorsConfig, SponsorsManager } from './license/index';
import { showProNotice } from './license/github-obsidian';
export const SPONSORS: SponsorsConfig = {
	clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5,
	oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user',
};
export const PRO_UI = {
	proSummary: 'Pro adds pinned views and per-view icons.',
	priceText: '$15 one time or $5 a month. A total payment of $15 meets the payment requirement for Pro.',
};
export const PRO_ONCE_URL = 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-view-tabs';

/** Lead of the Pro notice for the Pin view and icon items of the tab menu. */
export const PRO_LEAD = 'Pinned views and view icons need Pro.';

/** Shows the shared Pro notice: the lead, then the next step for this user. A free user gets a Sponsor on GitHub button. */
export function proNotice(pro: SponsorsManager | null, lead: string): void {
	showProNotice(pro, lead);
}
