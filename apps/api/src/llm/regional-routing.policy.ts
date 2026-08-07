import { DataSensitivity } from '@prisma/client';

/**
 * RoutingDecision — where a given prompt should be routed.
 * - 'domestic': 국내 LLM / 국내 리전 (금융 민감 → 강제)
 * - 'any': 자유 (해외 LLM 허용)
 */
export type RoutingDecision = 'domestic' | 'any';

/**
 * RegionalRoutingPolicy — the KEY abstraction reflecting the regional routing
 * principle (TECH §3.1):
 *
 * - FINANCIAL_SENSITIVE → 'domestic' (국내 강제)
 * - PERSONAL → 'domestic' (국내 우선)
 * - GENERAL → 'any' (자유)
 */
export class RegionalRoutingPolicy {
  route(sensitivity: DataSensitivity): RoutingDecision {
    switch (sensitivity) {
      case DataSensitivity.FINANCIAL_SENSITIVE:
        return 'domestic';
      case DataSensitivity.PERSONAL:
        return 'domestic';
      case DataSensitivity.GENERAL:
        return 'any';
      default:
        // Exhaustive safety: unknown sensitivity defaults to domestic.
        return 'domestic';
    }
  }
}
