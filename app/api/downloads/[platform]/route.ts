import { failure } from '@/src/lib/api-response';
import { findClientDownload } from '@/src/lib/client-downloads';
import { createTraceId } from '@/src/lib/trace';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const artifact = findClientDownload(platform, new URL(request.url).searchParams.get('variant'));
  if (!artifact) {
    const response = failure({ code: 4041, message: '没有该平台或版本类型的安装包', traceId: createTraceId(), status: 404 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  // A relative, catalog-owned Location cannot be turned into an external redirect by Host/query input.
  return new Response(null, { status: 307, headers: {
    Location: artifact.url,
    'Cache-Control': 'no-store',
  } });
}

export const HEAD = GET;
