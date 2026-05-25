import { z } from "zod";

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Mirror of the API's `scheduledFor` contract for client-side shape checking.
 *
 * The server is the authoritative judge — it owns the 60-minute lead-time
 * rule (clock-skew defense). This refine catches obvious shape mistakes
 * (plain "2026-05-09" with no time, non-strings, malformed input) before
 * the network round-trip, with a clearer error than the API's response.
 */
export const scheduledForSchema = z
  .union([z.literal("immediate"), z.string()])
  .refine(
    (v) => v === "immediate" || ISO_8601_RE.test(v),
    {
      message:
        'scheduledFor must be the literal "immediate" or an ISO 8601 timestamp ' +
        "with timezone (e.g. 2026-05-09T14:30:00Z).",
    },
  );
