import type { PageLoad } from './$types';
import { normalizeToken } from '@/lib/share/token';

export const load: PageLoad = ({ params }) => {
	return { token: normalizeToken(params.token) ?? params.token };
};
