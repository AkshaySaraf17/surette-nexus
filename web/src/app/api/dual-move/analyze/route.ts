import { z } from "zod";
import { agentBriefing, analyze, dualMoveInputSchema, knownAmounts } from "@/lib/dual-move";
import { complete, onlyKnownAmounts } from "@/lib/server/ai";
import { handler, parseBody, rateLimit } from "@/lib/server/http";

const schema = z.object({ inputs: dualMoveInputSchema, explain: z.boolean().default(false) });

/**
 * POST /api/dual-move/analyze — deterministic scenarios from the user's assumptions.
 * With explain=true and local AI available, adds a plain-English explanation that may only
 * use amounts present in the calculation; otherwise the built-in summary is used.
 */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "dual-move", 120, 10 * 60_000);
  const { inputs, explain } = await parseBody(request, schema);
  const result = analyze(inputs);
  let explanation: { text: string; engine: string } | null = null;
  if (explain) {
    const ai = await complete(
      [
        {
          role: "system",
          content:
            "You explain home sale-and-purchase estimates in plain English for a homeowner. Use ONLY the numbers given. Never introduce new figures, rates or predictions. Say these are estimates, not loan approvals or advice. 4-6 sentences.",
        },
        { role: "user", content: `${result.summary}\n\nFlags: ${result.gaps.join(" ") || "none"}\nScenarios: ${result.scenarios.map((s) => `${s.label}: housing ${Math.round(s.result.monthlyHousingCents / 100)} dollars/month, ${s.result.gapCents > 0 ? `shortfall ${Math.round(s.result.gapCents / 100)}` : `cushion ${Math.round(-s.result.gapCents / 100)}`} dollars`).join("; ")}` },
      ],
      { temperature: 0.2, maxTokens: 350 },
    );
    explanation = ai && onlyKnownAmounts(ai.text, knownAmounts(result, inputs)) ? ai : { text: result.summary, engine: "rules" };
  }
  return Response.json({ result, briefing: agentBriefing(inputs, result), explanation });
});
