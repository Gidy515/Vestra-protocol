export const DEFAULT_AVATARS = ['✦','◈','◎','✳','↗'];
export function validAvatar(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (DEFAULT_AVATARS.includes(value)) return true;
  if (value.length > 90_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  return bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
    && bytes.toString('ascii',12,16) === 'IHDR'
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 256
    && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 256;
}
