import "server-only";
import type { UtilityBill } from "@/lib/types";
import { withDb, type DbContext } from "./db";

/** Water / electric / other utility bills per property. Amounts are integer cents end to end. */

interface BillRow {
  id: string;
  property_id: string;
  property_title: string;
  utility: UtilityBill["utility"];
  provider: string;
  account_last4: string | null;
  period_start: string;
  period_end: string;
  usage_quantity: number | null;
  usage_unit: UtilityBill["usageUnit"];
  amount_cents: number;
  due_on: string | null;
  paid_on: string | null;
  notes: string | null;
  created_at: Date;
}

export function toBill(row: BillRow): UtilityBill {
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyTitle: row.property_title,
    utility: row.utility,
    provider: row.provider,
    accountLast4: row.account_last4,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    usageQuantity: row.usage_quantity,
    usageUnit: row.usage_unit,
    amountCents: row.amount_cents,
    dueOn: row.due_on,
    paidOn: row.paid_on,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

const BILL_SELECT = `
  SELECT b.id, b.property_id, p.title AS property_title, b.utility, b.provider, b.account_last4, b.period_start,
         b.period_end, b.usage_quantity, b.usage_unit, b.amount_cents, b.due_on, b.paid_on, b.notes, b.created_at
    FROM utility_ledgers b JOIN properties p ON p.id = b.property_id`;

export async function listBills(context: DbContext, propertyId?: string): Promise<{ bills: UtilityBill[]; totals: { utility: string; amountCents: number; unpaidCents: number }[] }> {
  return withDb(context, async (db) => {
    const filter = propertyId ? "WHERE b.property_id = $1" : "";
    const values = propertyId ? [propertyId] : [];
    const bills = await db.query<BillRow>(`${BILL_SELECT} ${filter} ORDER BY b.period_end DESC, b.created_at DESC LIMIT 500`, values);
    // Sums are computed in SQL over BIGINT cents: exact, no floating point.
    const totals = await db.query<{ utility: string; amount_cents: number; unpaid_cents: number }>(
      `SELECT b.utility::text AS utility,
              sum(b.amount_cents)::bigint AS amount_cents,
              coalesce(sum(b.amount_cents) FILTER (WHERE b.paid_on IS NULL), 0)::bigint AS unpaid_cents
         FROM utility_ledgers b ${filter}
        GROUP BY b.utility ORDER BY b.utility`,
      values,
    );
    return {
      bills: bills.map(toBill),
      totals: totals.map((t) => ({ utility: t.utility, amountCents: t.amount_cents, unpaidCents: t.unpaid_cents })),
    };
  });
}

export async function getBill(context: DbContext, id: string): Promise<UtilityBill | null> {
  const row = await withDb(context, (db) => db.one<BillRow>(`${BILL_SELECT} WHERE b.id = $1`, [id]));
  return row ? toBill(row) : null;
}
