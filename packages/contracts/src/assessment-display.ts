import { z } from "zod";

export const ASSESSMENT_ICONS = [
  "users", "shield", "link", "activity", "key", "search", "server",
  "database", "network", "cost", "code",
] as const;
export const AssessmentIconSchema = z.enum(ASSESSMENT_ICONS);
export type AssessmentIcon = z.infer<typeof AssessmentIconSchema>;

function plainText(maximum: number) {
  return z.string().min(1).max(maximum).refine(
    (text) => text.trim().length > 0 && !/[<>\p{Cc}\p{Cf}]/u.test(text),
    "Expected plain display text",
  );
}

export const AssessmentDisplaySchema = z.object({
  icon: AssessmentIconSchema.optional(),
  tags: z.array(plainText(32)).max(6)
    .refine((tags) => new Set(tags).size === tags.length, "Duplicate tags")
    .readonly().optional(),
  source: plainText(120).refine(
    (text) => !/(?:\b[a-z][a-z0-9+.-]*:\S|www\.)/i.test(text), "Source is text, not a URL",
  ).optional(),
}).strict().readonly();
export type AssessmentDisplay = z.infer<typeof AssessmentDisplaySchema>;
