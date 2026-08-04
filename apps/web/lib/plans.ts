export const PLAN_LIMITS: Record<string, number> = {
  free:    50,
  starter: 5_000,
  pro:     50_000,
}

export function limitForPlan(plan: string): number {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
