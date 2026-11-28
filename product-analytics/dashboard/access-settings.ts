const teamDomain = /^https:\/\/[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.cloudflareaccess\.com$/;
const audienceTag = /^[a-f\d]{64}$/;

export function accessSettings(team: string | undefined, audience: string | undefined) {
  if (!team || !audience || !teamDomain.test(team) || !audienceTag.test(audience)) return;
  return { issuer: team, audience };
}
