export type ModerationSeverity = "low" | "medium" | "high" | "critical";

export type ModerationCategory =
  | "banned_content"
  | "unauthorized_promotion"
  | "suspicious_link"
  | "scam"
  | "credential_theft"
  | "malware"
  | "spam"
  | "mention_abuse";

export interface ModerationDetection {
  category: ModerationCategory;
  severity: ModerationSeverity;
  rule: string;
  reason: string;
  score: number;
}
