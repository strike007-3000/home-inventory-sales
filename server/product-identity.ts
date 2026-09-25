export function productIdentityKey(
  name: string,
  colour: string | null | undefined,
  size: string | null | undefined,
): string {
  const normalize = (value: string | null | undefined) =>
    (value ?? '').trim().normalize('NFKC').toLowerCase();
  return JSON.stringify([normalize(name), normalize(colour), normalize(size)]);
}
