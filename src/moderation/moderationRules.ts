import { ModerationDetection } from "./moderationTypes";

const DISCORD_INVITE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[a-z0-9-]+/i;
const TELEGRAM_LINK = /(?:https?:\/\/)?(?:www\.)?t\.me\/[a-z0-9_+/-]+/i;
const SHORTENER = /(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly|shorturl\.at)\/[\w-]+/i;

const RULES: Array<{
  category: ModerationDetection["category"];
  severity: ModerationDetection["severity"];
  rule: string;
  reason: string;
  pattern: RegExp;
  score: number;
}> = [
  {
    category: "credential_theft",
    severity: "critical",
    rule: "credential-theft",
    reason: "Possible credential/account theft or credential selling",
    pattern: /(?:selling|buying|selling\s+access|buying\s+access|steal|stolen|dumped|logs?)\s+(?:accounts?|credentials?|passwords?|cookies?|tokens?)/i,
    score: 100,
  },
  {
    category: "malware",
    severity: "critical",
    rule: "malware-distribution",
    reason: "Possible malware or malicious payload distribution",
    pattern: /(?:sell|selling|buy|download|send|share|deploy)\s+(?:malware|ransomware|stealer|keylogger|rat\b|remote\s+access\s+trojan|botnet)/i,
    score: 100,
  },
  {
    category: "scam",
    severity: "high",
    rule: "payment-scam",
    reason: "Possible payment scam or fraudulent transaction",
    pattern: /(?:send|pay|transfer)\s+(?:crypto|bitcoin|usdt|money)\s+(?:first|now)\s+(?:and|then)\s+(?:i|we)\s+(?:will|send|give)/i,
    score: 75,
  },
  {
    category: "unauthorized_promotion",
    severity: "high",
    rule: "discord-promotion",
    reason: "Unauthorized Discord/server promotion",
    pattern: /(?:join|come\s+to|invite|members?)\s+(?:my|our|the)\s+(?:server|discord)/i,
    score: 70,
  },
  {
    category: "unauthorized_promotion",
    severity: "high",
    rule: "hosting-promotion",
    reason: "Possible unauthorized hosting/service promotion",
    pattern: /(?:cheap|best|discount|sale|promo|promotion)\s+(?:vps|hosting|server)\b/i,
    score: 70,
  },
];

export function detectMessageContent(content: string): ModerationDetection | null {
  const text = content.trim();
  if (!text) return null;

  const matches: ModerationDetection[] = [];

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      matches.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        reason: rule.reason,
        score: rule.score,
      });
    }
  }

  if (DISCORD_INVITE.test(text)) {
    matches.push({
      category: "unauthorized_promotion",
      severity: "medium",
      rule: "discord-invite",
      reason: "Discord invite link detected",
      score: 50,
    });
  }

  if (TELEGRAM_LINK.test(text)) {
    matches.push({
      category: "unauthorized_promotion",
      severity: "medium",
      rule: "telegram-link",
      reason: "Telegram link detected",
      score: 45,
    });
  }

  if (SHORTENER.test(text)) {
    matches.push({
      category: "suspicious_link",
      severity: "medium",
      rule: "link-shortener",
      reason: "URL shortener detected",
      score: 45,
    });
  }

  const mentionCount = (text.match(/<@!?\d+>/g) ?? []).length;
  if (mentionCount >= 5) {
    matches.push({
      category: "mention_abuse",
      severity: mentionCount >= 10 ? "high" : "medium",
      rule: "mass-mentions",
      reason: `${mentionCount} user mentions in one message`,
      score: mentionCount >= 10 ? 80 : 50,
    });
  }

  if (matches.length === 0) return null;

  return matches.sort((a, b) => b.score - a.score)[0];
}
