import { redirect } from "next/navigation";

/** Collections now live in the customer account (Saved homes). */
export default function CollectionsPage() {
  redirect("/account");
}
