import { success } from '@/src/lib/api-response';
import { getClientDownloads } from '@/src/lib/client-downloads';
import { createTraceId } from '@/src/lib/trace';

export const dynamic = 'force-dynamic';

export function GET() {
  const response = success(getClientDownloads(), createTraceId());
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
