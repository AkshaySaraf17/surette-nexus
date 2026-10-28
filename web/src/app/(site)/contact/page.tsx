import type { Metadata } from "next";
import { ContactForm } from "@/components/site/contact-form";

export const metadata: Metadata = { title: "Contact Surette Real Estate" };

export default function ContactPage() {
  return (
    <div data-tone="paper" className="mx-auto grid max-w-[1200px] gap-16 px-5 pb-32 pt-32 sm:px-8 lg:grid-cols-2">
      <div>
        <p className="type-eyebrow text-brand">Contact</p>
        <h1 className="type-display mt-3">Let&rsquo;s talk about your next move.</h1>
        <dl className="mt-10 space-y-5 text-lg">
          <div><dt className="type-eyebrow text-ink-3">Office</dt><dd className="mt-1">113 Silver Street, Waterville, ME 04901</dd></div>
          <div><dt className="type-eyebrow text-ink-3">Phone</dt><dd className="mt-1"><a href="tel:+12076496893" className="underline-offset-4 hover:underline">(207) 649-6893</a></dd></div>
          <div><dt className="type-eyebrow text-ink-3">Email</dt><dd className="mt-1"><a href="mailto:jjolicoeur@surette-realestate.com" className="underline-offset-4 hover:underline">jjolicoeur@surette-realestate.com</a></dd></div>
        </dl>
        <p className="mt-10 max-w-md text-sm text-ink-2">Prefer to chat? The AI assistant (bottom right) can search homes and connect you with an agent any time.</p>
      </div>
      <ContactForm />
    </div>
  );
}
