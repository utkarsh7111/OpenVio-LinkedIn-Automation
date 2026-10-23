const URN = /^urn:li:(person|share|ugcPost|image|video|document):[A-Za-z0-9_-]+$/;

export function isLinkedInUrn(value: unknown, type?: string): value is string {
  if (typeof value !== 'string' || !URN.test(value)) return false;
  return type ? value.startsWith(`urn:li:${type}:`) : true;
}

export function assertLinkedInUrn(value: unknown, type?: string): string {
  if (!isLinkedInUrn(value, type)) throw new TypeError(`Invalid LinkedIn ${type ?? ''} URN`.trim());
  return value;
}

export function personUrn(memberId: unknown): string {
  if (typeof memberId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(memberId)) throw new TypeError('Invalid LinkedIn member id');
  return `urn:li:person:${memberId}`;
}
