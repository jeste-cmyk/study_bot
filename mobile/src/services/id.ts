/**
 * Small, dependency-free unique-id generator. Good enough for client-side row
 * ids; Supabase columns default to gen_random_uuid() server-side anyway.
 */
export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}
