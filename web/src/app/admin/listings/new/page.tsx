import type { Metadata } from "next";
import Link from "next/link";
import { ListingForm } from "@/components/admin/listing-form";

export const metadata: Metadata = { title: "New listing" };

export default function NewListingPage() {
  return (
    <div>
      <Link href="/admin/listings" className="text-sm text-ink-2 hover:text-ink">← Listings</Link>
      <h1 className="type-title mt-3 mb-8">New listing</h1>
      <ListingForm />
    </div>
  );
}
